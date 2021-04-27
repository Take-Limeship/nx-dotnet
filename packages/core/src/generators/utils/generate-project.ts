import {
  addProjectConfiguration,
  formatFiles,
  getWorkspaceLayout,
  names,
  NxJsonProjectConfiguration,
  ProjectConfiguration,
  ProjectType,
  readWorkspaceConfiguration,
  Tree,
} from '@nrwl/devkit';

import { readFileSync, writeFileSync } from 'fs';
import { dirname, relative } from 'path';
import { XmlDocument, XmlNode, XmlTextNode } from 'xmldoc';

import { DotNetClient, dotnetNewOptions } from '@nx-dotnet/dotnet';
import { findProjectFileInPath, isDryRun } from '@nx-dotnet/utils';

import {
  GetBuildExecutorConfiguration,
  GetServeExecutorConfig,
  GetTestExecutorConfig,
  NxDotnetProjectGeneratorSchema,
} from '../../models';
import initSchematic from '../init/generator';

interface NormalizedSchema extends NxDotnetProjectGeneratorSchema {
  projectName: string;
  projectRoot: string;
  projectDirectory: string;
  projectLanguage: string;
  projectTemplate: string;
  parsedTags: string[];
  className: string;
  namespaceName: string;
}

function normalizeOptions(
  host: Tree,
  options: NxDotnetProjectGeneratorSchema,
  projectType: ProjectType
): NormalizedSchema {
  const name = names(options.name).fileName;
  const className = names(options.name).className;
  const projectDirectory = options.directory
    ? `${names(options.directory).fileName}/${name}`
    : name;
  const projectName = projectDirectory.replace(new RegExp('/', 'g'), '-');
  const projectRoot = `${
    projectType === 'application'
      ? getWorkspaceLayout(host).appsDir
      : getWorkspaceLayout(host).libsDir
  }/${projectDirectory}`;
  const parsedTags = options.tags
    ? options.tags.split(',').map((s) => s.trim())
    : [];
  parsedTags.push('nx-dotnet');

  const npmScope = names(readWorkspaceConfiguration(host).npmScope).className;
  const featureScope = projectDirectory
    .split('/')
    .map((part) => names(part).className);
  const namespaceName = [npmScope, ...featureScope].join('.');

  return {
    ...options,
    name,
    className,
    projectName,
    projectRoot,
    projectDirectory,
    parsedTags,
    projectLanguage: options.language,
    projectTemplate: options.template,
    namespaceName,
  };
}

async function GenerateTestProject(
  schema: NormalizedSchema,
  host: Tree,
  dotnetClient: DotNetClient,
  projectType: ProjectType
) {
  const testName = schema.name + '-test';
  const testRoot = schema.projectRoot + '-test';
  const testProjectName = schema.projectName + '-test';

  addProjectConfiguration(host, testProjectName, {
    root: testRoot,
    projectType: projectType,
    sourceRoot: `${testRoot}`,
    targets: {
      build: GetBuildExecutorConfiguration(testName),
      test: GetTestExecutorConfig(),
    },
    tags: schema.parsedTags,
  });

  const newParams: dotnetNewOptions = [
    {
      flag: 'language',
      value: schema.language,
    },
    {
      flag: 'name',
      value: schema.namespaceName + '.Test',
    },
    {
      flag: 'output',
      value: schema.projectRoot + '-test',
    },
  ];

  if (isDryRun()) {
    newParams.push({
      flag: 'dry-run',
    });
  }

  dotnetClient.new(schema['test-template'], newParams);

  if (!isDryRun() && !schema.skipOutputPathManipulation) {
    const testCsProj = await findProjectFileInPath(testRoot);
    SetOutputPath(host, testProjectName, testCsProj);
    const baseCsProj = await findProjectFileInPath(schema.projectRoot);
    SetOutputPath(host, schema.projectName, baseCsProj);
    dotnetClient.addProjectReference(testCsProj, baseCsProj);
  }
}

function SetOutputPath(
  host: Tree,
  projectName: string,
  projectFilePath: string
): void {
  const xml: XmlDocument = new XmlDocument(
    readFileSync(projectFilePath).toString()
  );

  let outputPath = `${relative(
    dirname(projectFilePath),
    process.cwd()
  )}/dist/${projectName}`;
  outputPath = outputPath.replace('\\', '/'); // Forward slash works on windows, backslash does not work on mac/linux

  const textNode: Partial<XmlTextNode> = {
    text: outputPath,
    type: 'text',
  };
  textNode.toString = () => textNode.text ?? '';
  textNode.toStringWithIndent = () => textNode.text ?? '';

  const el: Partial<XmlNode> = {
    name: 'OutputPath',
    attr: {},
    type: 'element',
    children: [textNode as XmlTextNode],
    firstChild: null,
    lastChild: null,
  };

  el.toStringWithIndent = xml.toStringWithIndent.bind(el);
  el.toString = xml.toString.bind(el);

  xml.childNamed('PropertyGroup')?.children.push(el as XmlNode);

  writeFileSync(projectFilePath, xml.toString());
}

export async function GenerateProject(
  host: Tree,
  options: NxDotnetProjectGeneratorSchema,
  dotnetClient: DotNetClient,
  projectType: ProjectType
) {
  initSchematic(host);

  options['test-template'] = options['test-template'] ?? 'none';

  const normalizedOptions = normalizeOptions(host, options, projectType);

  const projectConfiguration: ProjectConfiguration &
    NxJsonProjectConfiguration = {
    root: normalizedOptions.projectRoot,
    projectType: projectType,
    sourceRoot: `${normalizedOptions.projectRoot}`,
    targets: {
      build: GetBuildExecutorConfiguration(normalizedOptions.name),
      serve: GetServeExecutorConfig(),
    },
    tags: normalizedOptions.parsedTags,
  };

  if (options['test-template'] !== 'none') {
    projectConfiguration.targets.test = GetTestExecutorConfig(
      normalizedOptions.projectName + '-test'
    );
  }

  addProjectConfiguration(
    host,
    normalizedOptions.projectName,
    projectConfiguration
  );

  const newParams: dotnetNewOptions = [
    {
      flag: 'language',
      value: normalizedOptions.language,
    },
    {
      flag: 'name',
      value: normalizedOptions.namespaceName,
    },
    {
      flag: 'output',
      value: normalizedOptions.projectRoot,
    },
  ];

  if (isDryRun()) {
    newParams.push({
      flag: 'dry-run',
    });
  }

  dotnetClient.new(normalizedOptions.template, newParams);

  if (options['test-template'] !== 'none') {
    await GenerateTestProject(
      normalizedOptions,
      host,
      dotnetClient,
      projectType
    );
  } else if (!options.skipOutputPathManipulation) {
    SetOutputPath(
      host,
      normalizedOptions.projectName,
      await findProjectFileInPath(normalizedOptions.projectRoot)
    );
  }

  await formatFiles(host);
}