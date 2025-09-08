.DEFAULT_GOAL := all

NPM := bun

setup:
	$(NPM) install

compile:
	$(MAKE) -C contract compile NPM=$(NPM)

test:
	$(MAKE) -C contract test NPM=$(NPM)

clean:
	git clean -dxf

all: setup compile test

.PHONY: all setup compile test clean
