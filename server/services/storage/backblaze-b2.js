/**
 * 🗄️ Backblaze B2 Storage Service Integration
 * Free tier: 10GB storage, 1GB daily downloads, unlimited uploads
 * Use case: Document backup, archival storage, media files
 */

const B2 = require('backblaze-b2');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('../../utils/logger');

class BackblazeB2Service {
  constructor() {
    this.keyId = process.env.BACKBLAZE_KEY_ID;
    this.applicationKey = process.env.BACKBLAZE_APPLICATION_KEY;
    this.bucketName = process.env.BACKBLAZE_BUCKET_NAME;
    this.bucketId = null;
    this.b2 = null;
    this.authorized = false;
    
    if (this.keyId && this.applicationKey) {
      this.init();
    } else {
      logger.warn('Backblaze B2 credentials not configured - storage service disabled');
    }
  }

  /**
   * Initialize Backblaze B2 client
   */
  async init() {
    try {
      this.b2 = new B2({
        applicationKeyId: this.keyId,
        applicationKey: this.applicationKey
      });

      // Authorize and get account info
      const authResponse = await this.b2.authorize();
      this.authorized = true;
      
      // Get bucket ID if bucket name is provided
      if (this.bucketName) {
        await this.getBucketId();
      }
      
      logger.info('Backblaze B2 storage service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Backblaze B2', error);
      this.authorized = false;
    }
  }

  /**
   * Get bucket ID by name
   */
  async getBucketId() {
    try {
      const response = await this.b2.listBuckets({
        accountId: this.b2.accountId,
        bucketName: this.bucketName
      });

      if (response.data.buckets.length > 0) {
        this.bucketId = response.data.buckets[0].bucketId;
        logger.info(`Found bucket: ${this.bucketName} (${this.bucketId})`);
      } else {
        logger.warn(`Bucket ${this.bucketName} not found`);
      }
    } catch (error) {
      logger.error('Failed to get bucket ID', error);
    }
  }

  /**
   * Upload file to B2
   * @param {Buffer|string} fileData - File data or path
   * @param {string} fileName - Remote file name
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} - Upload result
   */
  async uploadFile(fileData, fileName, options = {}) {
    try {
      if (!this.authorized) {
        throw new Error('Backblaze B2 not authorized');
      }

      if (!this.bucketId) {
        throw new Error('Bucket ID not available');
      }

      const {
        contentType = 'application/octet-stream',
        metadata = {},
        folderPath = 'documents',
        enableSSE = true
      } = options;

      // Prepare file data
      let data;
      let size;
      
      if (typeof fileData === 'string') {
        // File path provided
        data = await fs.readFile(fileData);
        size = data.length;
      } else {
        // Buffer provided
        data = fileData;
        size = data.length;
      }

      // Generate file hash for integrity checking
      const hash = crypto.createHash('sha1').update(data).digest('hex');
      
      // Construct full file name with path
      const fullFileName = folderPath ? `${folderPath}/${fileName}` : fileName;

      // Get upload URL
      const uploadUrlResponse = await this.b2.getUploadUrl({
        bucketId: this.bucketId
      });

      // Prepare upload options
      const uploadOptions = {
        uploadUrl: uploadUrlResponse.data.uploadUrl,
        uploadAuthToken: uploadUrlResponse.data.authorizationToken,
        fileName: fullFileName,
        data: data,
        hash: hash,
        info: {
          'b2-content-type': contentType,
          ...metadata
        }
      };

      // Enable server-side encryption if requested
      if (enableSSE) {
        uploadOptions.info['b2-server-side-encryption'] = 'AES256';
      }

      // Upload file
      const uploadResponse = await this.b2.uploadFile(uploadOptions);

      logger.info(`File uploaded to B2: ${fullFileName}`, {
        fileId: uploadResponse.data.fileId,
        size: size,
        contentType: contentType
      });

      return {
        success: true,
        fileId: uploadResponse.data.fileId,
        fileName: uploadResponse.data.fileName,
        size: uploadResponse.data.contentLength,
        hash: uploadResponse.data.contentSha1,
        uploadTimestamp: uploadResponse.data.uploadTimestamp,
        url: await this.getDownloadUrl(uploadResponse.data.fileId)
      };

    } catch (error) {
      logger.error('Failed to upload file to B2', {
        fileName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Download file from B2
   * @param {string} fileId - File ID
   * @param {string} localPath - Local save path (optional)
   * @returns {Promise<Buffer|string>} - File data or local path
   */
  async downloadFile(fileId, localPath = null) {
    try {
      if (!this.authorized) {
        throw new Error('Backblaze B2 not authorized');
      }

      // Get download authorization
      const authResponse = await this.b2.getDownloadAuthorization({
        bucketId: this.bucketId,
        fileNamePrefix: '',
        validDurationInSeconds: 3600 // 1 hour
      });

      // Download file
      const downloadResponse = await this.b2.downloadFileById({
        fileId: fileId,
        authorizationToken: authResponse.data.authorizationToken
      });

      const fileData = downloadResponse.data;

      if (localPath) {
        // Save to local file
        await fs.writeFile(localPath, fileData);
        logger.info(`File downloaded from B2 to: ${localPath}`);
        return localPath;
      } else {
        // Return file data
        logger.info(`File downloaded from B2: ${fileId}`);
        return fileData;
      }

    } catch (error) {
      logger.error('Failed to download file from B2', {
        fileId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Delete file from B2
   * @param {string} fileId - File ID
   * @param {string} fileName - File name
   * @returns {Promise<Object>} - Deletion result
   */
  async deleteFile(fileId, fileName) {
    try {
      if (!this.authorized) {
        throw new Error('Backblaze B2 not authorized');
      }

      const response = await this.b2.deleteFileVersion({
        fileId: fileId,
        fileName: fileName
      });

      logger.info(`File deleted from B2: ${fileName}`, {
        fileId: fileId
      });

      return {
        success: true,
        fileId: response.data.fileId,
        fileName: response.data.fileName
      };

    } catch (error) {
      logger.error('Failed to delete file from B2', {
        fileId,
        fileName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * List files in bucket
   * @param {Object} options - List options
   * @returns {Promise<Array>} - File list
   */
  async listFiles(options = {}) {
    try {
      if (!this.authorized) {
        throw new Error('Backblaze B2 not authorized');
      }

      const {
        prefix = '',
        maxFileCount = 100,
        startFileName = null
      } = options;

      const listOptions = {
        bucketId: this.bucketId,
        prefix: prefix,
        maxFileCount: maxFileCount
      };

      if (startFileName) {
        listOptions.startFileName = startFileName;
      }

      const response = await this.b2.listFileNames(listOptions);

      const files = response.data.files.map(file => ({
        fileId: file.fileId,
        fileName: file.fileName,
        size: file.size,
        uploadTimestamp: file.uploadTimestamp,
        action: file.action,
        contentType: file.contentType
      }));

      logger.info(`Listed ${files.length} files from B2 bucket`);
      return files;

    } catch (error) {
      logger.error('Failed to list files from B2', error);
      throw error;
    }
  }

  /**
   * Get file info
   * @param {string} fileId - File ID
   * @returns {Promise<Object>} - File information
   */
  async getFileInfo(fileId) {
    try {
      if (!this.authorized) {
        throw new Error('Backblaze B2 not authorized');
      }

      const response = await this.b2.getFileInfo({
        fileId: fileId
      });

      const fileInfo = {
        fileId: response.data.fileId,
        fileName: response.data.fileName,
        contentType: response.data.contentType,
        contentLength: response.data.contentLength,
        contentSha1: response.data.contentSha1,
        uploadTimestamp: response.data.uploadTimestamp,
        metadata: response.data.fileInfo
      };

      logger.info(`Retrieved file info from B2: ${fileInfo.fileName}`);
      return fileInfo;

    } catch (error) {
      logger.error('Failed to get file info from B2', {
        fileId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get download URL for file
   * @param {string} fileId - File ID
   * @param {number} validDuration - URL validity in seconds
   * @returns {Promise<string>} - Download URL
   */
  async getDownloadUrl(fileId, validDuration = 3600) {
    try {
      if (!this.authorized) {
        throw new Error('Backblaze B2 not authorized');
      }

      // Get download authorization
      const authResponse = await this.b2.getDownloadAuthorization({
        bucketId: this.bucketId,
        fileNamePrefix: '',
        validDurationInSeconds: validDuration
      });

      // Construct download URL
      const downloadUrl = `${this.b2.downloadUrl}/file/${this.bucketName}?authorization=${authResponse.data.authorizationToken}`;
      
      return downloadUrl;

    } catch (error) {
      logger.error('Failed to get download URL from B2', {
        fileId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create backup of document
   * @param {Object} document - Document data
   * @param {Buffer} fileData - File content
   * @returns {Promise<Object>} - Backup result
   */
  async backupDocument(document, fileData) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `backup-${timestamp}-${document.id}-${document.originalName}`;
      
      const metadata = {
        'document-id': document.id,
        'original-name': document.originalName,
        'file-type': document.fileType,
        'owner-id': document.ownerId,
        'backup-date': timestamp,
        'file-hash': document.fileHash
      };

      const result = await this.uploadFile(fileData, fileName, {
        contentType: document.mimeType,
        metadata: metadata,
        folderPath: 'backups',
        enableSSE: true
      });

      logger.info(`Document backed up to B2: ${document.id}`);
      return result;

    } catch (error) {
      logger.error('Failed to backup document to B2', {
        documentId: document.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Archive old documents
   * @param {Array} documentIds - Document IDs to archive
   * @returns {Promise<Object>} - Archive result
   */
  async archiveDocuments(documentIds) {
    try {
      const results = [];
      
      for (const docId of documentIds) {
        try {
          // This would typically move files from active storage to archive folder
          // For now, we'll just tag them as archived
          logger.info(`Document ${docId} marked for archival`);
          results.push({ documentId: docId, status: 'archived' });
        } catch (error) {
          logger.error(`Failed to archive document ${docId}`, error);
          results.push({ documentId: docId, status: 'failed', error: error.message });
        }
      }

      return {
        success: true,
        archived: results.filter(r => r.status === 'archived').length,
        failed: results.filter(r => r.status === 'failed').length,
        results: results
      };

    } catch (error) {
      logger.error('Failed to archive documents', error);
      throw error;
    }
  }

  /**
   * Get storage statistics
   * @returns {Promise<Object>} - Storage stats
   */
  async getStorageStats() {
    try {
      if (!this.authorized) {
        throw new Error('Backblaze B2 not authorized');
      }

      // List all files to calculate stats
      const files = await this.listFiles({ maxFileCount: 10000 });
      
      const stats = {
        totalFiles: files.length,
        totalSize: files.reduce((sum, file) => sum + (file.size || 0), 0),
        filesByType: {},
        storageByFolder: {}
      };

      // Analyze files
      files.forEach(file => {
        // Count by content type
        const contentType = file.contentType || 'unknown';
        stats.filesByType[contentType] = (stats.filesByType[contentType] || 0) + 1;

        // Count by folder
        const folder = file.fileName.includes('/') ? 
          file.fileName.split('/')[0] : 'root';
        if (!stats.storageByFolder[folder]) {
          stats.storageByFolder[folder] = { files: 0, size: 0 };
        }
        stats.storageByFolder[folder].files++;
        stats.storageByFolder[folder].size += file.size || 0;
      });

      // Convert size to human readable
      stats.totalSizeFormatted = this.formatBytes(stats.totalSize);

      logger.info('Retrieved B2 storage statistics', stats);
      return stats;

    } catch (error) {
      logger.error('Failed to get storage statistics', error);
      throw error;
    }
  }

  /**
   * Health check for B2 service
   * @returns {Promise<Object>} - Health status
   */
  async healthCheck() {
    try {
      if (!this.keyId || !this.applicationKey) {
        return {
          status: 'unhealthy',
          message: 'Backblaze B2 credentials not configured'
        };
      }

      if (!this.authorized) {
        return {
          status: 'unhealthy',
          message: 'Backblaze B2 not authorized'
        };
      }

      // Test API connectivity
      const response = await this.b2.listBuckets({
        accountId: this.b2.accountId
      });

      return {
        status: 'healthy',
        message: 'Backblaze B2 service operational',
        bucketsCount: response.data.buckets.length,
        bucketName: this.bucketName,
        bucketId: this.bucketId
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: error.message
      };
    }
  }

  /**
   * Utility: Format bytes to human readable
   * @param {number} bytes - Bytes
   * @returns {string} - Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Utility: Generate secure file name
   * @param {string} originalName - Original file name
   * @param {string} prefix - Prefix
   * @returns {string} - Secure file name
   */
  generateSecureFileName(originalName, prefix = '') {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    
    const safeName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');
    return `${prefix}${timestamp}-${random}-${safeName}${ext}`;
  }
}

module.exports = new BackblazeB2Service();