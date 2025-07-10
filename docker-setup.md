# Docker Setup Guide

This guide will help you set up and run the project in a Docker environment using the provided `Dockerfile` and `docker-compose.yml`. Follow the steps below:

---

## Prerequisites

Before proceeding, ensure you have the following installed:

1. **Docker**:

   - Install Docker by following the official [Docker Installation Guide](https://docs.docker.com/get-docker/).
   - Verify the installation:
     ```bash
     docker --version
     ```

2. **Docker Compose**:

   - Docker Compose is included with Docker Desktop for Windows and macOS. For Linux, install it separately:
     ```bash
     sudo apt install docker-compose
     ```
   - Verify the installation:
     ```bash
     docker-compose --version
     ```

3. **Git**:

   - To clone the project repository, install Git:
     ```bash
     sudo apt install git
     ```

4. **GitHub Personal Access Token**:
   - Create a Personal Access Token following [GitHub's Guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token).
   - Update your username at Docker Login step in `./github/workflows/docker-image.yml`.
   - Add the token as a secret in your GitHub repository following [this guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions#creating-secrets-for-a-repository).

---

## Steps to Set Up the Project

### 1. Clone the Repository

Clone the project repository and navigate to the project directory:

```bash
git clone <repository-url>
cd <project-directory>
```

Replace `<repository-url>` with the actual repository URL.

### 2. Review the Docker Compose File

Open the `docker-compose.yml` file and familiarize yourself with the services and configurations. Ensure that the ports and volumes do not conflict with other running applications on your system.

### 3. Build Docker Images

To build the Docker images defined in the `Dockerfile`, run:

```bash
docker-compose build
```

This command will create the necessary images for the project.

### 4. Run the Services

Start all the services defined in the `docker-compose.yml` file:

```bash
docker-compose up
```

- Add the `-d` flag to run in detached mode:
  ```bash
  docker compose up -d
  ```
- Monitor logs if needed:
  ```bash
  docker-compose logs -f
  ```

### 5. Access the Application

Once all services are running, you can access the application in your browser or via API clients:

- **Frontend**:
  Visit [http://localhost:<frontend-port>](http://localhost:<frontend-port>) (Replace `<frontend-port>` with the actual port number).

- **Backend**:
  If applicable, the backend API will be available at [http://localhost:<backend-port>](http://localhost:<backend-port>).

---

## Managing the Environment

### Stop the Services

To stop all running services:

```bash
docker compose down
```

### Restart Specific Services

To restart a specific service without restarting its dependencies, use the following command:

```bash
docker compose up --no-deps <service-name> -d
```

Replace `<service-name>` with the name of the service from the `docker-compose.yml` file.

#### Use Case

- This command is particularly useful when you need to:

  - Restart a single container (e.g., katpool-app, katpool-monitor) after code or config changes.
  - Avoid restarting dependent services such as Redis, Postgres, or Prometheus.

  - Minimize downtime and resource usage during development or maintenance.

### Clean Up

Remove unused Docker images, containers, and volumes to free up space:

```bash
docker system prune -a
```

> **Note**: This will remove **all** unused resources.

---

## Troubleshooting

### 1. Docker Daemon Not Running

Ensure the Docker daemon is running. For Linux:

```bash
sudo systemctl start docker
```

### 2. Port Conflicts

If you encounter port conflicts, modify the `ports` section in `docker-compose.yml` to use different ports.

### 3. Permission Denied

If you encounter permission issues, try running Docker commands with `sudo` or add your user to the `docker` group:

```bash
sudo usermod -aG docker $USER
```

Log out and log back in to apply the changes.

### 4. Check Logs

For detailed error messages, check the container logs:

```bash
docker logs <service-name>
```

---

## Additional Commands

### List Running Containers

```bash
docker ps
```

### Stop a Specific Container

```bash
docker stop <container-id>
```

### Remove a Container

```bash
docker rm <container-id>
```

### Remove an Image

```bash
docker rmi <image-id>
```

---

## Logging

### Journald Logging Driver

The `journald` driver sends logs to the systemd journal, which is managed by your host machine's system. This ensures that logs are accessible even after the container is stopped or removed. However, it's very important to manage the size of your journal logs to avoid the potential issue of log files growing too large over time, which could fill up disk space and affect system performance.

To ensure proper log management, you must make changes to the `journald` settings in your system's configuration file.

### Modifying `journald.conf`

To make sure your logs do not grow **uncontrollably**, update the `journald` configuration by editing the `journald.conf` file. This is a **crucial step**, as logs can quickly become very large if not limited. Failure to manage log size might cause problems with disk space, as the logs continue to grow without restrictions.

1. Open the `journald.conf` file for editing:

   ```bash
   sudo nano /etc/systemd/journald.conf
   ```

2. Add or modify the following settings to ensure that the journal logs are controlled:

   ```ini
   [Journal]
   Storage=persistent
   SystemMaxFileSize=1000M  # Maximum size of individual journal files
   SystemMaxFiles=20    # Number of archived journal files to keep
   ```

3. Save and exit the editor.

### Apply Changes

To apply the changes made to `journald.conf`, reload and restart the `systemd-journald` service:

```bash
sudo systemctl restart systemd-journald
```

### Various commands to view logs

```bash
journalctl CONTAINER_NAME=<service-name>

journalctl CONTAINER_NAME=<service-name> -f

journalctl -u docker -f

journalctl -u <service-name> --since "2025-01-01" --until "2025-01-02"

journalctl -u <service-name> -n 100
```

---

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Common Docker Commands Cheat Sheet](https://dockerlabs.collabnix.com/docker/cheatsheet/)
