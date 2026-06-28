FROM python:3.10-slim

# Install system dependencies for compiling mysqlclient
RUN apt-get update && apt-get install -y \
    default-libmysqlclient-dev \
    build-essential \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend files
COPY . .

# Create uploads directory (ephemeral storage for test images)
RUN mkdir -p uploads

# Expose port
EXPOSE 8080

# Run with Gunicorn, listening on the PORT provided by Cloud Run
CMD exec gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 0 app:app
