import os
import json
import subprocess
import requests
import sys
import time

def main():
    print("=== Smart Factory Cloud Run Deployment ===")
    
    # 1. Load credentials from firebase tools
    user_profile = os.environ.get('USERPROFILE', '')
    firebase_config_path = os.path.join(user_profile, '.config', 'configstore', 'firebase-tools.json')
    
    if not os.path.exists(firebase_config_path):
        print(f"Error: Firebase config file not found at {firebase_config_path}.")
        print("Please ensure you run firebase login or supply a valid session.")
        sys.exit(1)
        
    with open(firebase_config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
        
    refresh_token = config.get('tokens', {}).get('refresh_token')
    if not refresh_token:
        print("Error: Refresh token not found in Firebase configuration.")
        sys.exit(1)
        
    client_id = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com"
    client_secret = "j9iVZfS8kkCEFUPaAeJV0sAi"
    
    # 2. Get fresh OAuth2 Access Token
    print("Requesting fresh OAuth2 access token from Google...")
    token_url = "https://oauth2.googleapis.com/token"
    token_res = requests.post(token_url, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token"
    })
    
    if token_res.status_code != 200:
        print(f"Failed to refresh OAuth token: {token_res.text}")
        sys.exit(1)
        
    access_token = token_res.json().get('access_token')
    print("OAuth2 access token obtained successfully.")
    
    project_id = "smart-factory-776"
    region = "us-central1"
    repo_id = "smart-factory"
    service_id = "smart-factory-backend"
    image_tag = f"{region}-docker.pkg.dev/{project_id}/{repo_id}/{service_id}:latest"
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    # 2.1. Enable Required GCP APIs
    apis = [
        "serviceusage.googleapis.com",
        "artifactregistry.googleapis.com",
        "run.googleapis.com",
        "cloudbuild.googleapis.com"
    ]
    for api in apis:
        print(f"Enabling API {api} on project {project_id}...")
        enable_url = f"https://serviceusage.googleapis.com/v1/projects/{project_id}/services/{api}:enable"
        enable_res = requests.post(enable_url, headers=headers)
        if enable_res.status_code == 200:
            print(f"API {api} enable request succeeded (operation started).")
        else:
            print(f"Note: API {api} enabling status: {enable_res.status_code} - {enable_res.text}")
            
    print("Waiting 15 seconds for API enablement to propagate...")
    time.sleep(15)
    
    # 2.2. Check/Start Docker daemon
    print("Checking if Docker daemon is running...")
    docker_check = subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=True)
    if docker_check.returncode != 0:
        print("Docker is not running. Attempting to start Docker Desktop...")
        docker_paths = [
            r"C:\Program Files\Docker\Docker\Docker Desktop.exe",
            r"C:\Program Files\Docker\Docker\resources\bin\dockerd.exe"
        ]
        started = False
        for path in docker_paths:
            if os.path.exists(path):
                print(f"Launching Docker Desktop from {path}...")
                subprocess.Popen([path], shell=True)
                started = True
                break
        
        if started:
            print("Waiting for Docker to start up (up to 45 seconds)...")
            for i in range(9):
                time.sleep(5)
                check = subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=True)
                if check.returncode == 0:
                    print("Docker daemon started successfully.")
                    break
            else:
                print("Error: Docker Desktop launched but did not start in time. Please verify Docker Desktop is running and try again.")
                sys.exit(1)
        else:
            print("Error: Could not find Docker Desktop executable. Please launch it manually and run the deployment again.")
            sys.exit(1)
    else:
        print("Docker daemon is running.")
    
    # 3. Create Artifact Registry
    print(f"Ensuring Artifact Registry repository '{repo_id}' exists in {region}...")
    repo_url = f"https://artifactregistry.googleapis.com/v1/projects/{project_id}/locations/{region}/repositories?repositoryId={repo_id}"
    create_repo_res = requests.post(repo_url, headers=headers, json={"format": "DOCKER"})
    
    if create_repo_res.status_code in [200, 201]:
        print(f"Repository '{repo_id}' created successfully.")
    elif create_repo_res.status_code == 409:
        print(f"Repository '{repo_id}' already exists.")
    else:
        print(f"Note: Repository creation status: {create_repo_res.status_code} - {create_repo_res.text}")
        
    # 4. Authenticate Docker local daemon
    print("Authenticating local Docker daemon...")
    login_process = subprocess.Popen(
        ["docker", "login", "-u", "oauth2accesstoken", "--password-stdin", f"https://{region}-docker.pkg.dev"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    stdout, stderr = login_process.communicate(input=access_token)
    if login_process.returncode != 0:
        print(f"Docker login failed: {stderr}")
        sys.exit(1)
    print("Docker authenticated successfully.")
    
    # 5. Build Docker Image
    print(f"Building Docker image: {image_tag}...")
    build_res = subprocess.run(["docker", "build", "-t", image_tag, "."], shell=True)
    if build_res.returncode != 0:
        print("Error: Docker build failed.")
        sys.exit(1)
    print("Docker image built successfully.")
    
    # 6. Push Docker Image
    print(f"Pushing Docker image to Artifact Registry...")
    push_res = subprocess.run(["docker", "push", image_tag], shell=True)
    if push_res.returncode != 0:
        print("Error: Docker push failed.")
        sys.exit(1)
    print("Docker image pushed successfully.")
    
    # 7. Check if Cloud Run service exists
    service_url = f"https://run.googleapis.com/v2/projects/{project_id}/locations/{region}/services/{service_id}"
    get_res = requests.get(service_url, headers=headers)
    
    service_body = {
        "template": {
            "containers": [
                {
                    "image": image_tag,
                    "resources": {
                        "limits": {
                            "cpu": "1000m",
                            "memory": "512Mi"
                        }
                    }
                }
            ]
        }
    }
    
    if get_res.status_code == 200:
        print(f"Cloud Run service '{service_id}' already exists. Updating it...")
        patch_res = requests.patch(service_url, headers=headers, json=service_body)
        if patch_res.status_code not in [200, 202]:
            print(f"Failed to update Cloud Run service: {patch_res.text}")
            sys.exit(1)
        print("Cloud Run service update triggered.")
    elif get_res.status_code == 404:
        print(f"Cloud Run service '{service_id}' does not exist. Creating new service...")
        create_url = f"https://run.googleapis.com/v2/projects/{project_id}/locations/{region}/services?serviceId={service_id}"
        post_res = requests.post(create_url, headers=headers, json=service_body)
        if post_res.status_code not in [200, 201, 202]:
            print(f"Failed to create Cloud Run service: {post_res.text}")
            sys.exit(1)
        print("Cloud Run service creation triggered.")
    else:
        print(f"Failed to inspect Cloud Run service status: {get_res.status_code} - {get_res.text}")
        sys.exit(1)
        
    # 8. Set IAM Policy to allow unauthenticated invocations (public endpoint)
    print("Setting IAM Policy to allow public access...")
    iam_url = f"https://run.googleapis.com/v2/projects/{project_id}/locations/{region}/services/{service_id}:setIamPolicy"
    iam_body = {
        "policy": {
            "bindings": [
                {
                    "role": "roles/run.invoker",
                    "members": [
                        "allUsers"
                    ]
                }
            ]
        }
    }
    iam_res = requests.post(iam_url, headers=headers, json=iam_body)
    if iam_res.status_code not in [200, 201]:
        print(f"Warning: Failed to set public access IAM policy: {iam_res.text}")
    else:
        print("IAM Policy configured to allow public access successfully.")
        
    print("\nCloud Run Deployment complete!")
    print(f"Service Name: {service_id}")
    print(f"GCP Project: {project_id}")
    print(f"Image Path: {image_tag}")

if __name__ == '__main__':
    main()
