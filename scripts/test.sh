#!/bin/bash

# Run all tests with the appropriate configuration

echo "Running worker tests with --no-check..."
deno test --allow-all --no-check tests/worker_test.ts

if [ $? -ne 0 ]; then
  echo "Worker tests failed. Exiting."
  exit 1
fi

echo "Running non-worker tests with type checking..."
deno test --allow-all tests/kernel_test.ts tests/manager_test.ts

if [ $? -ne 0 ]; then
  echo "Non-worker tests failed. Exiting."
  exit 1
fi

echo "All tests passed!" 