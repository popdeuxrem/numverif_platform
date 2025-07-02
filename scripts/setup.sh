#!/bin/bash

# VaultText Advanced Platform Setup Script
# This script helps you quickly set up the platform for development

set -e

echo "🛡️  VaultText Advanced Platform Setup"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Check if Node.js is installed
check_node() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_status "Node.js $NODE_VERSION is installed"
        
        # Check if version is 18 or higher
        MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
        if [ "$MAJOR_VERSION" -lt 18 ]; then
            print_error "Node.js version 18 or higher is required. Please upgrade."
            exit 1
        fi
    else
        print_error "Node.js is not installed. Please install Node.js 18+ first."
        echo "Visit: https://nodejs.org/"
        exit 1
    fi
}

# Check if npm is installed
check_npm() {
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm --version)
        print_status "npm $NPM_VERSION is installed"
    else
        print_error "npm is not installed. Please install npm first."
        exit 1
    fi
}

# Check if PostgreSQL is available
check_postgres() {
    if command -v psql &> /dev/null; then
        print_status "PostgreSQL is available"
    else
        print_warning "PostgreSQL not found. You'll need to install it separately."
        print_info "Visit: https://www.postgresql.org/download/"
    fi
}

# Check if Redis is available
check_redis() {
    if command -v redis-cli &> /dev/null; then
        print_status "Redis is available"
    else
        print_warning "Redis not found. You'll need to install it separately."
        print_info "Visit: https://redis.io/download"
    fi
}

# Install dependencies
install_dependencies() {
    print_info "Installing server dependencies..."
    npm install
    
    print_info "Installing client dependencies..."
    cd client && npm install
    cd ..
    
    print_status "Dependencies installed successfully"
}

# Setup environment file
setup_environment() {
    if [ ! -f .env ]; then
        print_info "Creating environment file..."
        cp .env.example .env
        print_status "Environment file created (.env)"
        print_warning "Please edit .env file with your configuration before starting the server"
    else
        print_status "Environment file already exists"
    fi
}

# Create necessary directories
create_directories() {
    print_info "Creating necessary directories..."
    
    mkdir -p logs
    mkdir -p uploads
    mkdir -p temp
    mkdir -p client/public/uploads
    
    print_status "Directories created"
}

# Generate JWT secrets if not present
generate_secrets() {
    if ! grep -q "your-super-secure-jwt-secret-here" .env 2>/dev/null; then
        print_status "JWT secrets already configured"
        return
    fi
    
    print_info "Generating JWT secrets..."
    
    # Generate random JWT secret
    JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    JWT_REFRESH_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
    
    # Replace in .env file
    if command -v sed &> /dev/null; then
        sed -i.bak "s/your-super-secure-jwt-secret-here/$JWT_SECRET/" .env
        sed -i.bak "s/your-super-secure-refresh-secret-here/$JWT_REFRESH_SECRET/" .env
        sed -i.bak "s/your-256-bit-encryption-key-here/$ENCRYPTION_KEY/" .env
        rm -f .env.bak
        print_status "JWT secrets generated"
    else
        print_warning "Could not automatically generate secrets. Please update .env manually."
    fi
}

# Setup database (if PostgreSQL is available)
setup_database() {
    if command -v createdb &> /dev/null; then
        print_info "Setting up database..."
        
        # Try to create database
        if createdb vaulttext 2>/dev/null; then
            print_status "Database 'vaulttext' created"
        else
            print_warning "Database might already exist or you need to configure PostgreSQL"
        fi
    else
        print_warning "PostgreSQL tools not available. Please create database manually."
    fi
}

# Check for required environment variables
check_env_vars() {
    if [ -f .env ]; then
        print_info "Checking environment configuration..."
        
        MISSING_VARS=()
        
        # Check for critical variables (examples)
        if ! grep -q "TWILIO_ACCOUNT_SID=" .env || grep -q "your-twilio-account-sid" .env; then
            MISSING_VARS+=("TWILIO_ACCOUNT_SID")
        fi
        
        if ! grep -q "OPENAI_API_KEY=" .env || grep -q "your-openai-api-key" .env; then
            MISSING_VARS+=("OPENAI_API_KEY")
        fi
        
        if [ ${#MISSING_VARS[@]} -gt 0 ]; then
            print_warning "The following environment variables need to be configured:"
            for var in "${MISSING_VARS[@]}"; do
                echo "  - $var"
            done
            print_info "Edit .env file to add these values"
        else
            print_status "Environment variables look good"
        fi
    fi
}

# Display next steps
show_next_steps() {
    echo ""
    echo "🎉 Setup completed!"
    echo ""
    echo "Next steps:"
    echo "1. Edit .env file with your API keys and configuration"
    echo "2. Start your database services (PostgreSQL, Redis)"
    echo "3. Run 'npm run dev' to start the development server"
    echo ""
    echo "The platform will be available at:"
    echo "  Frontend: http://localhost:3000"
    echo "  Backend:  http://localhost:5000"
    echo "  API Docs: http://localhost:5000/api/docs"
    echo ""
    echo "For more information, see README.md"
    echo ""
}

# Run setup with error handling
run_setup() {
    echo "Starting setup process..."
    echo ""
    
    check_node
    check_npm
    check_postgres
    check_redis
    echo ""
    
    install_dependencies
    echo ""
    
    setup_environment
    create_directories
    generate_secrets
    echo ""
    
    setup_database
    echo ""
    
    check_env_vars
    echo ""
    
    show_next_steps
}

# Handle script interruption
trap 'echo ""; print_error "Setup interrupted"; exit 1' INT

# Ask for confirmation
echo "This script will set up the VaultText Advanced Platform for development."
echo "It will install dependencies, create necessary files, and configure the environment."
echo ""
read -p "Do you want to continue? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    run_setup
else
    echo "Setup cancelled."
    exit 0
fi