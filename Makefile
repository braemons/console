# The console's package.
#
#   make deb            braemons-console (arch: all) into dist/
#   make check          syntax-check the modules with node
#
# The version is the git tag's (scripts/git-version.sh); pass CONSOLE_VERSION=...
# to build outside a tagged checkout. nfpm and node are the only tools needed.

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
DIST ?= $(ROOT)/dist

NFPM ?= nfpm
NODE ?= node

MAINTAINER ?= Joscha Schmiedt <joscha.schmiedt@gmail.com>

RESOLVED_VERSION := $(shell CONSOLE_VERSION='$(CONSOLE_VERSION)' $(ROOT)/scripts/git-version.sh 2>/dev/null)
VERSION = $(or $(RESOLVED_VERSION),$(error Cannot determine the version. Run \
scripts/git-version.sh to see why, or pass CONSOLE_VERSION=<version>))

deb: export VERSION = $(or $(RESOLVED_VERSION),$(error Cannot determine the version))
deb: export MAINTAINER := $(MAINTAINER)

.PHONY: deb check print-version clean help

help:
	@sed -n 's/^#   make \([a-z-]*\) *\(.*\)/  \1|\2/p' $(MAKEFILE_LIST) | column -t -s '|'

deb: check
	@mkdir -p $(DIST)
	cd packaging && $(NFPM) package -f nfpm.yaml -p deb -t $(DIST)/

check:
	@for module in serve.mjs discovery.mjs static/*.js; do $(NODE) --check $$module || exit 1; done

print-version:
	@echo $(VERSION)

clean:
	rm -rf $(DIST)
