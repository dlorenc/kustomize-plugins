# Copyright 2019 The Kubernetes Authors Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
FROM golang:1.12.4-stretch
RUN curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl
RUN chmod +x kubectl
RUN go get sigs.k8s.io/kustomize

FROM node:8.16.0-stretch

# install gcloud
# TODO: reduce the size of the container by cleaning up the apt package stuff
RUN apt-get update
RUN apt-get install lsb-core -y
RUN apt-get install build-essential -y
RUN export CLOUD_SDK_REPO="cloud-sdk-$(lsb_release -c -s)" && \
    echo "deb http://packages.cloud.google.com/apt $CLOUD_SDK_REPO main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list && \
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key add - && \
    apt-get update -y && apt-get install google-cloud-sdk -y

# add binaries
COPY --from=0 /go/bin/kustomize /usr/local/bin/kustomize
COPY --from=0 /go/kubectl /usr/local/bin/kubectl

# set plugin env
ENV XDG_CONFIG_HOME /.config/

# add SpringCloudPlatform plugin
RUN mkdir -p  /.config/kustomize/plugin/springcloud.kitops.dev/v1beta1
COPY springcloudplatform /usr/local/springcloud.kitops.dev
RUN ln -s /usr/local/springcloud.kitops.dev/cli.js /.config/kustomize/plugin/springcloud.kitops.dev/v1beta1/SpringCloudPlatform

