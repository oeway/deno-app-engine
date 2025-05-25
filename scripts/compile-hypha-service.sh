#!/bin/sh

# Check if Deno is installed
if ! command -v deno &> /dev/null; then
    echo "Deno is not installed. Please install Deno first:"
    echo "Visit https://deno.land/#installation for installation instructions"
    exit 1
fi

# Compile the hypha service
echo "Compiling hypha service..."

deno compile --allow-net --allow-read --allow-write --allow-env \
    --include=kernel/worker.ts \
    --include=kernel/tsWorker.ts \
    --include=kernel/pypi/all.json \
    --include=kernel/pypi/ipykernel-6.9.2-py3-none-any.whl \
    --include=kernel/pypi/piplite-0.6.0a5-py3-none-any.whl \
    --include=kernel/pypi/pyodide_kernel-0.6.0a5-py3-none-any.whl \
    --include=kernel/pypi/widgetsnbextension-3.6.999-py3-none-any.whl \
    --include=kernel/pypi/widgetsnbextension-4.0.999-py3-none-any.whl \
    --include=kernel/schema/piplite.v0.schema.json \
    scripts/hypha-service.ts