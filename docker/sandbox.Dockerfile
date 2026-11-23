# The image every LayerFS Sandbox runs: commands in a Workspace (the demos' bash calls) run here. Debian 12 like the
# client image, plus python3 and pytest for Demo 2's worker tests.
FROM node:22-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 python3-pytest procps \
	&& rm -rf /var/lib/apt/lists/*
