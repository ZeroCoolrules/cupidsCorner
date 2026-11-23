FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
# Fetch the voice-activity model at build time so the first call doesn't wait.
RUN python agent.py download-files
CMD ["python", "agent.py", "start"]
