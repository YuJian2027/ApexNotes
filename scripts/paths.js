const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith(`~${path.sep}`)) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolvePath(p) {
  return path.resolve(expandHome(p));
}

function getAppDir() {
  return resolvePath(process.env.APEXNOTES_HOME || path.join(os.homedir(), '.apexnotes'));
}

function getDataDir() {
  return resolvePath(process.env.APEXNOTES_DATA_DIR || path.join(getAppDir(), 'data'));
}

function getWelcomeFlagPath() {
  return resolvePath(process.env.APEXNOTES_WELCOME_FLAG || path.join(getAppDir(), '.welcomed'));
}

function getConfigPath() {
  return resolvePath(process.env.APEXNOTES_CONFIG_PATH || path.join(PROJECT_ROOT, 'config.json'));
}

module.exports = {
  PROJECT_ROOT,
  getAppDir,
  getDataDir,
  getWelcomeFlagPath,
  getConfigPath,
};
