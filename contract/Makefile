.DEFAULT_GOAL := compile-skip-zk

NPM ?= bun

compile:
	compact compile src/did.compact src/managed/did

compile-skip-zk:
	compact compile --skip-zk src/did.compact src/managed/did

test:
	$(NPM) run test

.PHONY: compile test
