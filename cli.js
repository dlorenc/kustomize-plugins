#!/usr/bin/env node

// Copyright 2019 The Kubernetes Authors Inc.
//
//     Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
//     You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
//     Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
//     WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//     See the License for the specific language governing permissions and
// limitations under the License.

const concat = require('mississippi').concat;
const yaml = require('js-yaml');
const lodash = require('lodash');

let plugin = yaml.safeLoad(process.env.KUSTOMIZE_PLUGIN_CONFIG_STRING)

let fn = function(str) {
    let resources = yaml.safeLoadAll(str);

    let discovery = resources.filter(r =>
        lodash.get(r, 'metadata.annotations["springcloud.kitops.dev/wire"]') == "discovery-service" &&
        lodash.get(r, "kind") == "Service")[0]
    if (!discovery) {
        console.error("no discovery-service service to auto-wire: \n" + str)
        process.exit(1)
    }

    let discoveryStatefulSet = resources.filter(r =>
        lodash.get(r, 'metadata.annotations["springcloud.kitops.dev/wire"]') == "discovery-service" &&
        lodash.get(r, "kind") == "StatefulSet")[0]
    if (!discovery) {
        console.error("no discovery-service statefulset to auto-wire: \n" + str)
        process.exit(1)
    }

    let config = resources.filter(r =>
        lodash.get(r, 'metadata.annotations["springcloud.kitops.dev/wire"]') == "config-service" &&
        lodash.get(r, "kind") == "Service")[0]
    if (!config) {
        console.error("no config-service to auto-wire: \\n" + str)
        process.exit(1)
    }

    resources = resources.map( function(r) {
        if (lodash.has(r, 'metadata.annotations["springcloud.kitops.dev/auto-wire"]') &&
            lodash.get(r, 'kind') == "Service") {

            // Set default labels and selectors derviced from the name
            lodash.merge(r.spec.selector ,{
                "app.kubernetes.io/component": r.metadata.name,
                "app.kubernetes.io/instance": "spring-cloud-" + r.metadata.name,
            })
            let labels = lodash.get(r, 'spec.selector')
            lodash.merge(r.metadata.labels, labels)

            // Set build annotations on the Resource
            lodash.set(r, 'metadata.annotations["app.kubernetes.io/image-tag"]', lodash.get(plugin, 'transform.container.image.tag'))

            // Merge into defaults - current Resource will override fields
            return lodash.merge(lodash.cloneDeep(serviceDefaults), r)
        }

        if (lodash.has(r, 'metadata.annotations["springcloud.kitops.dev/auto-wire"]') &&
            lodash.get(r, 'kind') == "Deployment") {

            // Set default labels and selectors derviced from the name
            lodash.merge(r.spec.selector.matchLabels ,{
                "app.kubernetes.io/component": r.metadata.name,
                "app.kubernetes.io/instance": "spring-cloud-" + r.metadata.name,
            })
            let labels = lodash.get(r, 'spec.selector.matchLabels')

            lodash.merge(lodash.get(r, 'metadata.labels'), labels)
            lodash.merge(lodash.get(r, 'spec.template.metadata.labels'), labels)

            // Get Eureka values from the SpringCloud transformer config
            let leaseRenewalSeconds = 30
            if (lodash.has(plugin, 'transform.discovery.leaseRenewalIntervalSeconds')) {
                leaseRenewalSeconds = lodash.get(plugin, 'transform.discovery.leaseRenewalIntervalSeconds')
            }
            let registryFetchSeconds = 30
            if (lodash.has(plugin, 'transform.discovery.registeryFetchIntervalSeconds')) {
                registryFetchSeconds = lodash.get(plugin, 'transform.discovery.registeryFetchIntervalSeconds')
            }
            let leaseExpirationSeconds = 30
            if (lodash.has(plugin, 'transform.discovery.leaseExpirationDurationSeconds')) {
                leaseExpirationSeconds = lodash.get(plugin, 'transform.discovery.leaseExpirationDurationSeconds')
            }

            // Get Eureka image from the SpringCloud transformer config
            let imageName = lodash.get(r, 'spec.template.spec.containers[0].name')
            if (lodash.has(plugin, 'transform.container.image.repo')) {
                imageName = lodash.get(plugin, 'transform.container.image.repo') + "/" + lodash.get(r, 'spec.template.spec.containers[0].image')
            }
            if (lodash.has(plugin, 'transform.container.image.tag')) {
                imageName = imageName + ":"  + lodash.get(plugin, 'transform.container.image.tag')
            }
            //
            lodash.set(r, 'spec.template.spec.containers[0].image', imageName)
            lodash.set(r, 'metadata.annotations["app.kubernetes.io/build-version"]', lodash.get(plugin, 'transform.container.image.tag'))

            let container = lodash.get(r, 'spec.template.spec.containers[0]')
            if (lodash.has(discoveryStatefulSet, 'spec.template.spec.containers[0].envFrom') && !lodash.has(r, 'spec.template.spec.containers[0].envFrom')) {
                let env = lodash.get(discoveryStatefulSet, 'spec.template.spec.containers[0].envFrom')
                lodash.set(container, "envFrom", env)
            }

            container.command = [
                "./dockerize" , "-wait=tcp://" + discovery.metadata.name + ":8761", "-timeout=60s", "--",
                "java", "-jar",  "/app.jar", "--eureka.client.serviceUrl.defaultZone=http://" + discovery.metadata.name + ":8761/eureka/",
                "--eureka.environment=prod", "--eureka.instance.leaseExpirationDurationInSeconds=" + leaseExpirationSeconds,
                "--eureka.instance.leaseRenewalIntervalInSeconds=" + leaseRenewalSeconds,
                "--eureka.instance.hostname=" + r.metadata.name,
                "--eureka.instance.registryFetchIntervalSeconds=" + registryFetchSeconds,
                "--server.port=8080",
                "--spring.cloud.config.uri=http://" + config.metadata.name + ":8888",
                "--spring.datasource.platform=$(SPRING_DATASOURCE_PLATFORM)",
                "--spring.datasource.url=$(SPRING_DATASOURCE_URL)",
            ]

            return lodash.merge(lodash.cloneDeep(deploymentDefaults), r)
        }

        return r
    })

    // emit the resources
    console.log(resources.reduce( (v, resource) => {
        if (v != "") {
            v = v + "---\n"
        }
        return v + yaml.safeDump(resource);
    }, ""));
}

// default values for Service Resources
let serviceDefaults = yaml.safeLoad(`apiVersion: v1
kind: Service
metadata:
    name: service
spec:
  ports:
    - name: "8080"
      port: 8080
      targetPort: 8080
`);

// default values for Deployment Resources
let deploymentDefaults = yaml.safeLoad(`apiVersion: apps/v1
kind: Deployment
metadata:
spec:
  replicas: 1
  minReadySeconds: 10
  strategy:
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 100%
  selector:
  template:
    spec:
      containers:
      - name: spring-cloud-service
        env:
          - name: JAVA_OPTS
            value: -XX:+UnlockExperimentalVMOptions -XX:+UseCGroupMemoryLimitForHeap -Djava.security.egd=file:/dev/./urandom
        ports:
        - containerPort: 8080
        resources:
          limits:
            memory: "536870912"
        readinessProbe:
          httpGet:
            path: '/actuator/health'
            port: 8080
          initialDelaySeconds: 5
          timeoutSeconds: 1
          periodSeconds: 5
      restartPolicy: Always
`);

process.stdin.pipe(concat(fn));

