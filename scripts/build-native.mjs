import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const [platform] = process.argv.slice(2)
const windows = process.platform === 'win32'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function requireTool(command, args, message) {
  if (spawnSync(command, args, { stdio: 'ignore' }).status !== 0) throw new Error(message)
}

try {
  if (platform === 'android') {
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
    const installed = sdk && existsSync(join(sdk, 'platforms', 'android-36')) &&
      existsSync(join(sdk, 'build-tools')) && readdirSync(join(sdk, 'build-tools')).some(name => name.startsWith('36.'))
    if (!installed && !existsSync('android/local.properties')) {
      throw new Error('Install Android SDK Platform 36 and Build Tools 36.x, then set ANDROID_HOME or open the Android project in Android Studio.')
    }
    const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java') : 'java'
    requireTool(java, ['-version'], 'Install JDK 21 and set JAVA_HOME before building the Android app.')
    run('npm', ['run', 'android:sync'], { shell: windows })
    run(windows ? 'gradlew.bat' : './gradlew', [':app:assembleDebug'], { cwd: 'android', shell: windows })
  } else if (platform === 'ios') {
    if (process.platform !== 'darwin') throw new Error('An iOS simulator build requires macOS and Xcode 26 or later.')
    requireTool('xcodebuild', ['-version'], 'Install Xcode 26 or later and select it with xcode-select.')
    run('npm', ['run', 'ios:sync'])
    run('xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug',
      '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'ios/DerivedData', 'CODE_SIGNING_ALLOWED=NO', 'build'])
  } else {
    throw new Error('Specify android or ios.')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
