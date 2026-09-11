const { withDangerousMod, withInfoPlist, withXcodeProject, IOSConfig } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
module.exports = (config) => {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Canvas', UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).CanvasSceneDelegate' }] },
    };
    return config;
  });
  config = withXcodeProject(config, (config) => {
    // Canvas loads JS from its explicit Metro session. Exit before Expo's older
    // bundle script expands a shell command containing an unquoted project path.
    for (const phase of Object.values(config.modResults.hash.project.objects.PBXShellScriptBuildPhase ?? {})) {
      if (!phase || typeof phase !== 'object' || !phase.shellScript?.includes('react-native-xcode.sh')) continue;
      const script = JSON.parse(phase.shellScript);
      const skip = 'if [ "$SKIP_BUNDLING" = "1" ]; then exit 0; fi\n';
      if (!script.startsWith(skip)) phase.shellScript = JSON.stringify(skip + script);
    }
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    for (const name of ['CanvasInspector.swift', 'CanvasRenderer.swift', 'ExpoRenderer.swift'])
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${projectName}/${name}`, groupName: projectName, project: config.modResults });
    return config;
  });
  return withDangerousMod(config, ['ios', async (config) => {
    const ios = config.modRequest.platformProjectRoot;
    const project = fs.readdirSync(ios).find((name) => fs.existsSync(path.join(ios, name, 'AppDelegate.swift')));
    if (!project) throw new Error('Expo native AppDelegate was not generated.');
    fs.copyFileSync(path.join(__dirname, 'native/CanvasHost.swift'), path.join(ios, project, 'AppDelegate.swift'));
    for (const name of ['CanvasInspector.swift', 'CanvasRenderer.swift', 'ExpoRenderer.swift'])
      fs.copyFileSync(path.join(__dirname, 'native', name), path.join(ios, project, name));
    for (const asset of fs.readdirSync(path.join(__dirname, 'assets')).filter((name) => /\.(imageset|dataset)$/.test(name))) {
      fs.cpSync(path.join(__dirname, 'assets', asset), path.join(ios, project, 'Images.xcassets', asset), { recursive: true });
    }
    return config;
  }]);
};
