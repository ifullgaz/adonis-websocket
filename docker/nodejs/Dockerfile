#####################################
# Use the official Node.js image
#####################################
FROM node:lts-alpine AS base

RUN apk update --no-cache && \
    apk upgrade --no-cache && \
    apk add --no-cache \
    tini


ARG CODE_PATH_CONTAINER=/app

# Set the working directory inside the container
WORKDIR ${CODE_PATH_CONTAINER}

#####################################
# Entrypoint
#####################################
COPY ./docker/nodejs/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
RUN ln -s /usr/local/bin/docker-entrypoint.sh /

# Define the command to run your app
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["docker-entrypoint.sh"]
