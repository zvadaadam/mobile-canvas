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
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${projectName}/CanvasInspector.swift`, groupName: projectName, project: config.modResults });
    return config;
  });
  return withDangerousMod(config, ['ios', async (config) => {
    const ios = config.modRequest.platformProjectRoot;
    const project = fs.readdirSync(ios).find((name) => fs.existsSync(path.join(ios, name, 'AppDelegate.swift')));
    if (!project) throw new Error('Expo native AppDelegate was not generated.');
    fs.copyFileSync(path.join(__dirname, 'native/CanvasHost.swift'), path.join(ios, project, 'AppDelegate.swift'));
    fs.copyFileSync(path.join(__dirname, 'native/CanvasInspector.swift'), path.join(ios, project, 'CanvasInspector.swift'));
    for (const asset of fs.readdirSync(path.join(__dirname, 'assets')).filter((name) => /\.(imageset|dataset)$/.test(name))) {
      fs.cpSync(path.join(__dirname, 'assets', asset), path.join(ios, project, 'Images.xcassets', asset), { recursive: true });
    }
    return config;
  }]);
};
