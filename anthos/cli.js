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
const child_process = require('child_process');
const yaml = require('js-yaml');
const lodash = require('lodash');

let plugin = yaml.safeLoad(process.env.KUSTOMIZE_PLUGIN_CONFIG_STRING)
const keyring = lodash.get(plugin, "transform.secrets.keyring")
const key = lodash.get(plugin, "transform.secrets.key")

let fn = function(str) {
    let resources = yaml.safeLoadAll(str);

    // apply transformations to Resources
    resources = resources.map( function(r) {
        // decrypt Secrets using kms
        if (r.kind == "Secret" && lodash.has(r, 'data') && keyring && key) {

            lodash.forEach(r.data, function(v64, k, map) {
                // decrypt the secret data
                const b64d = child_process.spawnSync(
                    'base64',
                    ['-i', '-', '--decode'],
                    {
                        input: v64,
                    }
                );
                if (b64d.status) {
                    console.error(b64d.stderr)
                    console.error(b64d.stdout)
                    process.exit(1)
                }
                const decrypted = child_process.spawnSync(
                    'gcloud',
                    ['kms', 'decrypt', '--project', 'protokit-238521', '--location', 'global', '--keyring', keyring, '--key', key, '--plaintext-file', '-', '--ciphertext-file', '-'],
                    {
                        input: b64d.stdout,
                    }
                );
                if (decrypted.status) {
                    console.error(decrypted.stderr)
                    console.error(decrypted.stdout)
                    process.exit(1)
                }
                const b64e = child_process.spawnSync(
                    'base64',
                    ['-i', '-'],
                    {
                        input: decrypted.stdout,
                    }
                );
                if (b64e.status) {
                    console.error(b64e.stderr)
                    console.error(b64e.stdout)
                    process.exit(1)
                }

                // set the datafield to be the decrypted data
                map[k] = b64e.stdout.toString('utf-8')
            })
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

process.stdin.pipe(concat(fn));

