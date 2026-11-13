# harbour-control: built from world/harbour-control, so the image carries the named SQL its tools run.
FROM docker:29.9.3-cli AS docker-cli

FROM python:3.15.2-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HARBOUR_SQL=/app/sql
# The docker CLI and compose plugin let the runner redeploy a release, exactly as an operator would.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv==0.13.8 && uv export --frozen --no-dev --no-emit-project -o requirements.txt && uv pip install --system --no-cache -r requirements.txt
COPY harbour_control harbour_control
COPY sql sql

EXPOSE 8090
CMD ["opentelemetry-instrument", "python", "-m", "harbour_control.main"]
