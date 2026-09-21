# Общий образ для api и demo-ark (только stdlib, ничего не ставим).
FROM python:3.12-alpine
RUN adduser -D app
WORKDIR /app
ARG SERVICE
COPY services/${SERVICE} /app
USER app
ENV HOST=0.0.0.0 PYTHONUNBUFFERED=1
CMD ["python3", "server.py"]
