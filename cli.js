#!/usr/bin/env node

// Copyright 2019 Google Inc.
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
    {
        let resources = yaml.safeLoadAll(str);

        let discovery = resources.filter(r =>
            lodash.get(r, 'metadata.annotations["springcloud.kitops.dev/wire"]') == "discovery-service" &&
            lodash.get(r, "kind") == "Service")[0]
        if (!discovery) {
            console.error("no discovery-service service to auto-wire.")
            console.error("inputs:" + str)
            process.exit(1)
        }

        let discoveryDeployment = resources.filter(r =>
            lodash.get(r, 'metadata.annotations["springcloud.kitops.dev/wire"]') == "discovery-service" &&
            lodash.get(r, "kind") == "StatefulSet")[0]
        if (!discovery) {
            console.error("no discovery-service statefulset to auto-wire.")
            console.error("inputs:" + str)
            process.exit(1)
        }

        let config = resources.filter(r =>
            lodash.get(r, 'metadata.annotations["springcloud.kitops.dev/wire"]') == "config-service" &&
            lodash.get(r, "kind") == "Service")[0]
        if (!config) {
            console.error("no config-service to auto-wire.")
            console.error("inputs:" + str)
            process.exit(1)
        }

        let apigateway = resources.filter(r =>
            lodash.get(r, 'metadata.annotations["springcloud.kitops.dev/wire"]') == "api-gateway-service" &&
            lodash.get(r, "kind") == "Service")[0]
        if (!config) {
            console.error("no api-gateway-service to auto-wire.")
            console.error("inputs:" + str)
            process.exit(1)
        }

        let servicesMap = resources
            .filter(r =>
                lodash.get(r, 'kind') == "Service" &&
                lodash.has(r, 'metadata.annotations["springcloud.kitops.dev/auto-wire"]'))
            .reduce(function(m, r) {
                m[lodash.get(r, 'metadata.name')] = r
                return m
            }, {})

        let generated = []

        resources = resources.map( function(r) {
            if (lodash.has(r, 'metadata.annotations["springcloud.kitops.dev/auto-wire"]') &&
                lodash.get(r, 'kind') == "Service") {

                lodash.merge(lodash.get(r, 'metadata.labels'), lodash.get(r, 'spec.selector'))
                lodash.set(r, 'metadata.annotations["app.kubernetes.io/build-version"]', lodash.get(plugin, 'transform.image.tag'))
                return lodash.merge(lodash.cloneDeep(serviceTemplate), r)
            }

            if (lodash.has(r, 'metadata.annotations["springcloud.kitops.dev/auto-wire"]') &&
                lodash.get(r, 'kind') == "Deployment") {

                let labels = lodash.get(r, 'spec.selector.matchLabels')
                if (!labels) {
                    lodash.set(r, 'spec.selector.matchLabels', {})
                }
                lodash.merge(r.spec.selector.matchLabels ,{
                        "app.kubernetes.io/component": r.metadata.name,
                        "app.kubernetes.io/instance": "spring-cloud-" + r.metadata.name,
                    })

                lodash.merge(lodash.get(r, 'metadata.labels'), labels)
                lodash.merge(lodash.get(r, 'spec.template.metadata.labels'), labels)

                let container = lodash.get(r, 'spec.template.spec.containers[0]')
                let service = servicesMap[lodash.get(r, 'metadata.name')]

                if (service) {
                    lodash.merge(service, {
                        spec: {
                            selector: labels
                        },
                    })
                } else if (lodash.get(r, 'metadata.annotations["springcloud.kitops.dev/auto-generate"]')) {
                    let generatedService = lodash.cloneDeep(serviceTemplate)
                    lodash.merge(generatedService, {
                        metadata: {
                            name: lodash.get(r, 'metadata.name'),
                            namespace: lodash.get(r, 'metadata.namespace'),
                            annotations: {
                                "springcloud.kitops.dev/generated-from": lodash.get(r, 'metadata.name'),
                            },
                        },
                        spec: {
                            selector: labels
                        },
                    })
                    generated.push(generatedService)
                } else {
                    console.error("no service to auto-wire for " + lodash.get(r, 'metadata.name') + ".  must specify service, or set 'springcloud.kitops.dev/auto-generate'")
                    process.exit(1)
                }

                let leaseRenewalSeconds = 30
                if (lodash.has(plugin, 'transform.leaseRenewalIntervalSeconds')) {
                    leaseRenewalSeconds = lodash.get(plugin, 'transform.leaseRenewalIntervalSeconds')
                }

                let registryFetchSeconds = 30
                if (lodash.has(plugin, 'transform.registeryFetchIntervalSeconds')) {
                    registryFetchSeconds = lodash.get(plugin, 'transform.registeryFetchIntervalSeconds')
                }

                let leaseExpirationSeconds = 30
                if (lodash.has(plugin, 'transform.leaseExpirationDurationSeconds')) {
                    leaseExpirationSeconds = lodash.get(plugin, 'transform.leaseExpirationDurationSeconds')
                }

                let imageName = lodash.get(r, 'spec.template.spec.containers[0].name')
                if (lodash.has(plugin, 'transform.image.repo')) {
                    imageName = lodash.get(plugin, 'transform.image.repo') + "/" + lodash.get(r, 'spec.template.spec.containers[0].image')
                }

                if (lodash.has(plugin, 'transform.image.tag')) {
                    imageName = imageName + ":"  + lodash.get(plugin, 'transform.image.tag')
                }

                lodash.set(r, 'spec.template.spec.containers[0].image', imageName)
                lodash.set(r, 'metadata.annotations["app.kubernetes.io/build-version"]', lodash.get(plugin, 'transform.image.tag'))

                if (lodash.has(discoveryDeployment, 'spec.template.spec.containers[0].envFrom') && !lodash.has(r, 'spec.template.spec.containers[0].envFrom')) {
                    let env = lodash.get(discoveryDeployment, 'spec.template.spec.containers[0].envFrom')
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


                return lodash.merge(lodash.cloneDeep(deploymentTemplate), r)
            }

            return r
        })

        resources = resources.concat(generated)

        console.log(resources.reduce( (v, resource) => {
            if (v != "") {
                v = v + "---\n"
            }
            return v + yaml.safeDump(resource);
        }, ""));


    }
}

let serviceTemplate = yaml.safeLoad(`apiVersion: v1
kind: Service
metadata:
    name: service
spec:
  ports:
    - name: "8080"
      port: 8080
      targetPort: 8080
`);

let deploymentTemplate = yaml.safeLoad(`apiVersion: apps/v1
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

