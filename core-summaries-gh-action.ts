import { Component, typescript } from 'projen';
import { GithubWorkflow, workflows } from 'projen/lib/github';


export class SummariesAction extends Component {
  constructor(project: typescript.TypeScriptAppProject) {
    super(project);

    const workflow: GithubWorkflow = project.github!.addWorkflow('core-team-summaries');

    // Running weekly on Sunday at 18:00 UTC
    // https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule
    // Reason for adding a buffer here is because Github does not guarantee running action on
    // scheduled time
    const schedule = '0 18 * * 0';

    const trigger: workflows.Triggers = {
      schedule: [{
        cron: schedule,
      }],
      workflowDispatch: {},
    };

    const runsOn = ['ubuntu-latest'];

    const summaries: workflows.Job = {
      runsOn: runsOn,
      permissions: {
        contents: workflows.JobPermission.READ,
        pullRequests: workflows.JobPermission.WRITE,
      },
      steps: [
        {
          name: 'Checkout',
          uses: 'actions/checkout@v3',
        },
        {
          name: 'Setup Node.js',
          uses: 'actions/setup-node@v3',
          with: { 'node-version': '18.12.0' },
        },
        {
          name: 'Install dependencies',
          run: 'yarn install --check-files',
        },
        {
          name: 'Run Summaries Script',
          run: 'npx ts-node ${{ github.workspace }}/src/construct-squad/core-team-weekly-stats.ts',
          env: { GITHUB_TOKEN: '${{ secrets.PROJEN_GITHUB_TOKEN }}' },
          continueOnError: false,
        },
      ],
    };

    workflow.on(trigger);
    workflow.addJob('generate-core-summaries', summaries);
  }
}

