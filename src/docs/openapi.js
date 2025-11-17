const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Automation Backend API',
    version: '1.0.0',
    description: 'API cho automation scripts, upload, và Chrome profile',
  },
  servers: [
    { url: 'http://localhost:3000' },
  ],
  tags: [
    { name: 'execute', description: 'Submit automation scripts and manage jobs' },
    { name: 'profile', description: 'Manage and launch Chrome profiles' },
    { name: 'system', description: 'System utilities like health and upload' },
    { name: 'gemini', description: 'Gemini automation' },
    { name: 'notebooklm', description: 'NotebookLM automation' },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        tags: ['system'],
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, ts: { type: 'number' } } } } },
          },
        },
      },
    },
    '/scripts': {
      post: {
        summary: 'Submit automation script',
        tags: ['execute'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Script' },
            },
          },
        },
        responses: {
          202: {
            description: 'Accepted',
            content: { 'application/json': { schema: { type: 'object', properties: { jobId: { type: 'string', format: 'uuid' } }, required: ['jobId'] } } },
          },
        },
      },
    },
    '/jobs': {
      get: {
        summary: 'List jobs',
        tags: ['execute'],
        responses: {
          200: {
            description: 'List of jobs',
            content: { 'application/json': { schema: { type: 'object', properties: { jobs: { type: 'array', items: { $ref: '#/components/schemas/Job' } } }, required: ['jobs'] } } },
          },
        },
      },
    },
    '/jobs/{id}': {
      get: {
        summary: 'Get job by id',
        tags: ['execute'],
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { job: { $ref: '#/components/schemas/Job' } }, required: ['job'] } } } },
          404: { description: 'Not Found' },
        },
      },
    },
    '/upload': {
      post: {
        summary: 'Upload a file',
        tags: ['system'],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
                required: ['file'],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Uploaded',
            content: { 'application/json': { schema: { type: 'object', properties: { filename: { type: 'string' }, path: { type: 'string' }, mimetype: { type: 'string' }, size: { type: 'number' } } } } },
          },
        },
      },
    },
    '/chrome/profiles': {
      get: {
        summary: 'List Chrome profiles',
        tags: ['profile'],
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'object', properties: { profiles: { type: 'array', items: { $ref: '#/components/schemas/ChromeProfileRecord' } } }, required: ['profiles'] } } },
          },
        },
      },
      post: {
        summary: 'Create Chrome profile (user-data-dir)',
        tags: ['profile'],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' } } },
            },
          },
        },
        responses: {
          201: {
            description: 'Created',
            content: { 'application/json': { schema: { type: 'object', properties: { profile: { $ref: '#/components/schemas/ChromeProfile' } }, required: ['profile'] } } },
          },
        },
      },
    },
    '/chrome/profiles/{id}': {
      get: {
        summary: 'Get Chrome profile by id',
        tags: ['profile'],
        parameters: [ { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } } ],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { profile: { $ref: '#/components/schemas/ChromeProfile' } }, required: ['profile'] } } } },
          404: { description: 'Not Found' },
        },
      },
    },
    '/chrome/profiles/launch': {
      post: {
        summary: 'Launch Chrome with user-data-dir/profile',
        tags: ['profile'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  userDataDir: { type: 'string' },
                  profileDirName: { type: 'string' },
                  extraArgs: { type: 'array', items: { type: 'string' } },
                  ensureGmail: { type: 'boolean', description: 'If true, open Gmail and navigate to login if not signed in' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Launched',
            content: { 'application/json': { schema: { type: 'object', properties: { launched: { type: 'boolean' }, pid: { type: 'integer' }, userDataDir: { type: 'string' }, profileDirName: { type: 'string' }, chromePath: { type: 'string' }, launchArgs: { type: 'array', items: { type: 'string' } }, gmailCheckStatus: { type: 'string', enum: ['skipped','already_logged_in','navigated_to_login','failed'] } }, required: ['launched','pid','userDataDir','profileDirName','chromePath','launchArgs'] } } },
          },
          400: { description: 'Bad Request' },
        },
      },
    },
    '/chrome/profiles/stop': {
      post: {
        summary: 'Stop Chrome by user-data-dir/profile',
        tags: ['profile'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  userDataDir: { type: 'string' },
                  profileDirName: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Stopped',
            content: { 'application/json': { schema: { type: 'object', properties: { stopped: { type: 'boolean' }, userDataDir: { type: 'string' }, profileDirName: { type: 'string' } }, required: ['stopped','userDataDir'] } } },
          },
          400: { description: 'Bad Request' },
        },
      },
    },
    '/chrome/profiles/login-gmail': {
      post: {
        summary: 'Ensure Gmail logged in (auto-fill credentials if needed)',
        tags: ['profile'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  userDataDir: { type: 'string' },
                  email: { type: 'string', description: 'Optional: pick credential by email from constants' },
                  accountIndex: { type: 'integer', description: 'Optional: index in constants if email not provided' },
                  debugPort: { type: 'integer', description: 'Optional DevTools port if not default' },
                },
                required: [],
              },
            },
          },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['already_logged_in','login_success','needs_verification','unknown','failed'] } }, required: ['status'] } } } },
          400: { description: 'Bad Request' },
          404: { description: 'Profile not found' },
        },
      },
    },
    '/chrome/chrome-path': {
      get: {
        summary: 'Get detected Chrome executable path',
        tags: ['profile'],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { chromePath: { type: 'string', nullable: true } }, required: ['chromePath'] } } } },
        },
      },
    },
    '/chrome/profiles-folder': {
      get: {
        summary: 'Get current profiles base directory',
        tags: ['profile'],
        description: 'Returns the folder path where Chrome profiles are stored. Default is platform-specific (Windows: AppData\\Local\\Automation_Profiles, macOS: ~/Library/Application Support/Automation_Profiles, Linux: ~/.config/automation_profiles)',
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    profilesBaseDir: { type: 'string', description: 'Absolute path to profiles base directory' },
                  },
                  required: ['profilesBaseDir'],
                },
              },
            },
          },
        },
      },
      put: {
        summary: 'Set profiles base directory',
        tags: ['profile'],
        description: 'Changes the folder where Chrome profiles are stored. The folder will be created if it does not exist. Configuration is saved to .profiles-config.json',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  folder: { type: 'string', description: 'Path to folder (absolute or relative). Will be resolved to absolute path.' },
                },
                required: ['folder'],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    profilesBaseDir: { type: 'string', description: 'Resolved absolute path to profiles base directory' },
                    message: { type: 'string', description: 'Success message' },
                  },
                  required: ['profilesBaseDir', 'message'],
                },
              },
            },
          },
          400: { description: 'Bad Request - validation error' },
        },
      },
    },
    '/gemini/gems/send-prompt': {
      post: {
        summary: 'Send a prompt to a specific Gem in Gemini',
        tags: ['gemini'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Profile name to use' },
                  userDataDir: { type: 'string', description: 'Profile user-data-dir (alternative to name)' },
                  profileDirName: { type: 'string' },
                  debugPort: { type: 'integer' },
                  gem: { type: 'string', description: 'Name of the Gem to select from sidebar' },
                  listFile: { type: 'array', items: { type: 'string' }, description: 'Array of absolute file paths to upload before sending prompt' },
                  prompt: { type: 'string', description: 'Prompt text to send to the Gem' },
                },
                required: ['gem', 'prompt'],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['prompt_sent', 'not_logged_in', 'gem_not_found', 'prompt_field_not_found', 'failed', 'unknown'], description: 'Status of the operation' },
                    error: { type: 'string', description: 'Error message if status is failed' },
                  },
                  required: ['status'],
                },
              },
            },
          },
          400: { description: 'Bad Request' },
          404: { description: 'Profile not found' },
        },
      },
    },
    '/gemini/gems/sync': {
      post: {
        summary: 'Sync and list all Gems from sidebar',
        tags: ['gemini'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Profile name to use' },
                  userDataDir: { type: 'string', description: 'Profile user-data-dir (alternative to name)' },
                  profileDirName: { type: 'string' },
                  debugPort: { type: 'integer' },
                },
                required: [],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['success', 'not_logged_in', 'failed', 'unknown'], description: 'Status of the operation' },
                    gems: { type: 'array', items: { type: 'string' }, description: 'Array of Gem names from sidebar' },
                    error: { type: 'string', description: 'Error message if status is failed' },
                  },
                  required: ['status', 'gems'],
                },
              },
            },
          },
          400: { description: 'Bad Request' },
          404: { description: 'Profile not found' },
        },
      },
    },
    '/gemini/gems': {
      post: {
        summary: 'Open Explore Gems and try to create a new Gem',
        tags: ['gemini'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Profile name to use' },
                  userDataDir: { type: 'string', description: 'Profile user-data-dir (alternative to name)' },
                  profileDirName: { type: 'string' },
                  gemName: { type: 'string', description: 'Gem name to fill on New Gem screen' },
                  description: { type: 'string' },
                  instructions: { type: 'string' },
                  knowledgeFiles: { type: 'array', items: { type: 'string' }, description: 'Array of absolute file paths on server to upload' },
                  debugPort: { type: 'integer' },
                },
                required: [],
              },
            },
          },
        },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } } },
          400: { description: 'Bad Request' },
          404: { description: 'Profile not found' },
        },
      },
    },
    '/notebooklm/launch': {
      post: {
        summary: 'Launch NotebookLM page in Chrome profile and handle welcome popup',
        tags: ['notebooklm'],
        description: 'Opens NotebookLM, automatically dismisses the welcome popup if it appears for new accounts, clicks "Create new notebook" button, and optionally adds sources (website, YouTube, or text content). After adding sources, optionally enters a prompt into the prompt textarea.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Profile name to use (alternative to userDataDir)' },
                  userDataDir: { type: 'string', description: 'Profile user-data-dir (alternative to name)' },
                  profileDirName: { type: 'string', description: 'Profile directory name' },
                  debugPort: { type: 'integer', description: 'Optional DevTools port if not default' },
                  website: { type: 'array', items: { type: 'string', format: 'url' }, description: 'Array of website URLs to add as source (clicks Website button and fills in textarea #mat-input-1, one URL per line)' },
                  youtube: { type: 'array', items: { type: 'string', format: 'url' }, description: 'Array of YouTube URLs to add as source (inserts one by one: clicks Add source, then YouTube button, fills in URL, clicks Insert, repeats for each URL)' },
                  textContent: { type: 'string', description: 'Text content to paste as source (clicks Copied text button and enters the text)' },
                  prompt: { type: 'string', description: 'Prompt to enter into the prompt textarea after all sources are added (finds textarea by formcontrolname="discoverSourcesQuery" or placeholder)' },
                  outputFile: { type: 'string', description: 'Full path to save generated text to file (e.g., "F:\\WorkSpace\\Automation_Create_Content\\profiles\\hoangdeptrai\\content\\response.txt"). Directory will be created automatically if it does not exist.' },
                },
                required: [],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['launched', 'notebook_created', 'not_logged_in', 'failed', 'unknown'], description: 'Status of the operation. notebook_created means Create new notebook button was clicked successfully.' },
                    url: { type: 'string', description: 'Current page URL' },
                    error: { type: 'string', description: 'Error message if status is failed' },
                  },
                  required: ['status'],
                },
              },
            },
          },
          400: { description: 'Bad Request - validation error' },
          404: { description: 'Profile not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      Script: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          steps: {
            type: 'array',
            items: { $ref: '#/components/schemas/Step' },
            minItems: 1,
          },
        },
        required: ['steps'],
      },
      Step: {
        oneOf: [
          { $ref: '#/components/schemas/MoveStep' },
          { $ref: '#/components/schemas/ClickStep' },
          { $ref: '#/components/schemas/TypeStep' },
          { $ref: '#/components/schemas/KeyPressStep' },
          { $ref: '#/components/schemas/KeyTapStep' },
          { $ref: '#/components/schemas/PasteStep' },
          { $ref: '#/components/schemas/WaitStep' },
        ],
        discriminator: { propertyName: 'action' },
      },
      MoveStep: {
        type: 'object',
        properties: { action: { const: 'move' }, x: { type: 'number' }, y: { type: 'number' }, durationMs: { type: 'integer', minimum: 1 } },
        required: ['action', 'x', 'y'],
      },
      ClickStep: {
        type: 'object',
        properties: { action: { const: 'click' }, button: { type: 'string', enum: ['left','right','middle'] }, double: { type: 'boolean' } },
        required: ['action'],
      },
      TypeStep: {
        type: 'object',
        properties: { action: { const: 'type' }, text: { type: 'string' } },
        required: ['action','text'],
      },
      KeyPressStep: {
        type: 'object',
        properties: { action: { const: 'keyPress' }, keys: { type: 'array', items: { type: 'string' }, minItems: 1 } },
        required: ['action','keys'],
      },
      KeyTapStep: {
        type: 'object',
        properties: { action: { const: 'keyTap' }, key: { type: 'string' } },
        required: ['action','key'],
      },
      PasteStep: {
        type: 'object',
        properties: { action: { const: 'paste' }, text: { type: 'string' } },
        required: ['action','text'],
      },
      WaitStep: {
        type: 'object',
        properties: { action: { const: 'wait' }, ms: { type: 'integer', minimum: 0 } },
        required: ['action','ms'],
      },
      Job: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['queued','running','completed','failed'] },
          createdAt: { type: 'string', format: 'date-time' },
          startedAt: { type: 'string', format: 'date-time', nullable: true },
          finishedAt: { type: 'string', format: 'date-time', nullable: true },
          error: { type: 'string', nullable: true },
        },
        required: ['id', 'status', 'createdAt'],
      },
      ChromeProfile: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          dirName: { type: 'string' },
          userDataDir: { type: 'string' },
          profileDirName: { type: 'string' },
          chromePath: { type: 'string', nullable: true },
          launchArgs: { type: 'array', items: { type: 'string' } },
          openCommand: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id','name','dirName','userDataDir','profileDirName','launchArgs','createdAt','updatedAt'],
      },
      ChromeProfileRecord: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          dirName: { type: 'string' },
          userDataDir: { type: 'string' },
          profileDirName: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
        required: ['id','name','dirName','userDataDir','profileDirName','createdAt','updatedAt'],
      },
    },
  },
};

module.exports = openapi;


