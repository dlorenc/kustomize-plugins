package main

import (
	"errors"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/ghodss/yaml"
)

func usage() {
	fmt.Printf("Usage: %s configFile.yaml\n", os.Args[0])
	os.Exit(1)
}

func main() {
	if len(os.Args) != 2 {
		usage()
	}
	configPath := os.Args[1]
	cfg, err := parseConfig(configPath)
	if err != nil {
		log.Fatal(err)
	}
	tmpDir, err := ioutil.TempDir("", "")
	if err != nil {
		log.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)
	fetchArgs := []string{
		"fetch", "--untar",
		"--untardir", tmpDir,
		fmt.Sprintf("%s/%s", cfg.Spec.Repository, cfg.Spec.ChartName)}

	fetchCmd := exec.Command("helm", fetchArgs...)
	out, err := fetchCmd.CombinedOutput()
	log.Println("Fetched helm chart into: ", tmpDir)
	log.Println(string(out))
	if err != nil {
		log.Fatal(err)
	}

	templateArgs := []string{"template"}
	if cfg.Spec.ValuesFile != "" {
		templateArgs = append(templateArgs, "--values", cfg.Spec.ValuesFile)
	}
	setArgs := []string{}
	for _, vo := range cfg.Spec.ValueOverrides {
		setArgs = append(setArgs, fmt.Sprintf("%s=%s", vo.Key, vo.Val))
	}
	setArg := strings.Join(setArgs, ",")
	if len(setArg) > 0 {
		templateArgs = append(templateArgs, "--set")
		templateArgs = append(templateArgs, setArg)
	}

	mfstDir, err := ioutil.TempDir("", "")
	if err != nil {
		log.Fatal(err)
	}
	defer os.RemoveAll(mfstDir)

	templateArgs = append(templateArgs, fmt.Sprintf("--output-dir=%s", mfstDir))
	templateArgs = append(templateArgs, filepath.Join(tmpDir, cfg.Spec.ChartName))

	log.Println("About to run: ", templateArgs)
	templateCmd := exec.Command("helm", templateArgs...)
	out, err = templateCmd.CombinedOutput()
	log.Println("Templated helm chart into: ", mfstDir)
	log.Println(string(out))
	if err != nil {
		log.Fatal(err)
	}

	templateDir := filepath.Join(mfstDir, cfg.Spec.ChartName, "templates")
	mfsts, err := ioutil.ReadDir(templateDir)
	if err != nil {
		log.Fatal(err)
	}

	for _, mfst := range mfsts {
		b, err := ioutil.ReadFile(filepath.Join(templateDir, mfst.Name()))
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(string(b))
	}
}

func parseConfig(p string) (*Config, error) {
	b, err := ioutil.ReadFile(p)
	if err != nil {
		return nil, err
	}
	cfg := &Config{}
	if err := yaml.Unmarshal(b, cfg); err != nil {
		return nil, err
	}

	if cfg.Spec.ChartName == "" {
		return nil, errors.New("chartName required")
	}
	if cfg.Spec.Repository == "" {
		cfg.Spec.Repository = "stable"
	}
	return cfg, err
}

type Config struct {
	Spec struct {
		ValueOverrides []Value
		ChartName      string
		Repository     string
		ValuesFile     string
	}
}

type Value struct {
	Key string
	Val string
}
