# 1. Build and push your image
docker build -t halopsa-adapter:latest ./adapter

# 2. Apply Kubernetes manifests
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# 3. Point Alertmanager at the adapter (in-cluster URL)
# http://halopsa-adapter.monitoring.svc.cluster.local/webhook


# Alertmanager config

receivers:
  - name: halopsa-tickets
    webhook_configs:
      - url: 'http://halopsa-adapter.monitoring.svc.cluster.local/webhook'
        send_resolved: false

route:
  receiver: halopsa-tickets