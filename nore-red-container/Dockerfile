FROM nodered/node-red-docker

# Install MySQL and InfluxDB
RUN npm install node-red-node-mysql
RUN npm install node-red-contrib-influxdb

# Copy the HTTPin and Savvy nodes
ADD httpin-node/* ./node_modules/node-red/nodes/core/io/
ADD savvy-node/* /savvy_node_data/

# Needs to be root to make the npm links
USER root
WORKDIR /savvy_node_data/
RUN npm install
RUN npm link
WORKDIR /data
RUN npm link savvy-contrib

# Change to default Node-RED working directory
WORKDIR /usr/src/node-red