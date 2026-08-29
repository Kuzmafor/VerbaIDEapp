export const PROJECT_TEMPLATES = [
  { id: 'vite', title: 'Vite + React', badge: 'Web', description: 'Быстрый React-сайт с Vite.', files: {
    'package.json': JSON.stringify({ name: 'verba-vite-app', private: true, version: '0.0.0', scripts: { dev: 'vite', build: 'vite build', test: 'vitest' }, dependencies: { '@vitejs/plugin-react': 'latest', vite: 'latest', react: 'latest', 'react-dom': 'latest' }, devDependencies: {} }, null, 2),
    'index.html': '<!doctype html>\n<html lang="ru"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>VerbaIDE app</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
    'src/main.jsx': "import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport './style.css'\n\nfunction App() { return <main><h1>Привет, VerbaIDE!</h1><p>Начните создавать приложение.</p></main> }\ncreateRoot(document.getElementById('root')).render(<App />)",
    'src/style.css': 'body { margin: 0; font-family: system-ui; background: #101014; color: #f6f6f8; }\nmain { max-width: 720px; margin: 0 auto; padding: 64px 20px; }',
  } },
  { id: 'python', title: 'Python', badge: 'Python', description: 'Минимальный проект с тестом pytest.', files: {
    'main.py': "def greet(name: str) -> str:\n    return f'Привет, {name}!'\n\n\nif __name__ == '__main__':\n    print(greet('VerbaIDE'))\n",
    'test_main.py': "from main import greet\n\n\ndef test_greet():\n    assert greet('Мир') == 'Привет, Мир!'\n",
    'requirements.txt': 'pytest\n', 'README.md': '# Python-проект\n\nЗапуск: `python main.py`\n',
  } },
  { id: 'android', title: 'Android', badge: 'Kotlin', description: 'Стартовый Android-проект на Kotlin.', files: {
    'settings.gradle.kts': 'pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name = "VerbaApp"\ninclude(":app")\n',
    'build.gradle.kts': 'plugins {\n    id("com.android.application") version "8.5.0" apply false\n    id("org.jetbrains.kotlin.android") version "2.0.0" apply false\n}\n',
    'app/build.gradle.kts': 'plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }\n\nandroid { namespace = "com.example.verba"; compileSdk = 35\n defaultConfig { applicationId = "com.example.verba"; minSdk = 24; targetSdk = 35; versionCode = 1; versionName = "1.0" } }\n',
    'app/src/main/AndroidManifest.xml': '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="Verba App"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>',
    'app/src/main/java/com/example/verba/MainActivity.kt': 'package com.example.verba\n\nimport android.app.Activity\nimport android.os.Bundle\n\nclass MainActivity : Activity() { override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState) } }\n',
  } },
  { id: 'blank', title: 'Пустой проект', badge: 'Empty', description: 'Чистая папка с README.', files: { 'README.md': '# Новый проект\n\nОпишите задачу для ИИ или добавьте файлы.\n' } },
]

export function findTemplate(id) { return PROJECT_TEMPLATES.find((item) => item.id === id) || PROJECT_TEMPLATES[0] }
