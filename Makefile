# FSW Layer 0 — developer entry points.
# From a clean clone: `make dev` should be all that is required (spec §71).

SHELL := /bin/bash
.DEFAULT_GOAL := help

DB_NAME ?= fsw_layer0
DB_TEST_NAME ?= fsw_layer0_test

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: dev
dev: install db-up migrate seed ## Clean clone to running system
	npm run dev

.PHONY: install
install: ## Install dependencies
	npm ci || npm install

.PHONY: db-up
db-up: ## Start PostgreSQL and create databases
	@bash scripts/db-up.sh

.PHONY: db-down
db-down: ## Stop PostgreSQL
	@bash scripts/db-down.sh

.PHONY: migrate
migrate: ## Apply all pending migrations
	npm run db:migrate

.PHONY: seed
seed: ## Load metadata configuration and demonstration seed data
	npm run metadata:apply
	npx tsx tools/seed.ts

.PHONY: test
test: ## Run the test suite (excludes performance tests)
	npm run test

.PHONY: test-perf
test-perf: ## Run performance benchmarks
	npm run test:perf

.PHONY: check
check: ## Everything CI runs
	npm run format:check
	npm run lint
	npm run typecheck
	npm run db:verify
	npm run test

.PHONY: reset
reset: ## Drop and rebuild the development database
	npm run db:reset
	$(MAKE) migrate seed
