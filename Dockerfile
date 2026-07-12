# EdgeCast API for Fly.io — the frontend deploys separately to Vercel.
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir ".[server]"
COPY fixtures ./fixtures

# edgecast.db lives on the mounted volume so snapshots and verification
# history survive deploys and restarts.
EXPOSE 8000
CMD ["edgecast", "serve", "--host", "0.0.0.0", "--port", "8000", "--db", "/data/edgecast.db"]
