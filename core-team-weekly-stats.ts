//import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import { Api } from '@octokit/plugin-rest-endpoint-methods/dist-types/types';
import { throttling } from '@octokit/plugin-throttling';
import { getMarkdownTable } from 'markdown-table-ts';
//import { query as graphqlQuery, types, params, rawString } from 'typed-graphqlify';

interface WeekIssueSummary {
  start: Date;
  end: Date;
  openIssues: number;
  incomingP0Issues: number;
  openP1Issues: number;
  incomingP1Issues: number;
  resolvedP1Issues: number;
  openP2Issues: number;
  incomingP2Issues: number;
  resolvedP2Issues: number;
}

interface Cached {
  readonly summaries: WeekIssueSummary[];
  readonly firstUnprocessedDate: Date;
}

//let DEBUG = false;

class CoreIssueStats {
  readonly CORE_LABLES = ['cli', 'toolkit/migrate', 'package/tools', 'package/cfn', 'hotswap', '@aws-cdk/triggers', '@aws-cdk/region-info', '@aws-cdk/pipelines', '@aws-cdk/integ-tests', '@aws-cdk/integ-runner', '@aws-cdk/cx-api', '@aws-cdk/core', '@aws-cdk/cloudformation-diff', '@aws-cdk/cloud-assembly-schema', '@aws-cdk/cfnspec', '@aws-cdk/assets', '@aws-cdk/assert', '@aws-cdk/assertions'];


  constructor(private readonly octokit: Octokit & Api) {}


  public async buildTable() {
    const {
      summaries,
      firstUnprocessedDate,
    } = await this.loadCached();

    const result = summaries.concat(await this.summariesFrom(firstUnprocessedDate));
    fs.writeFileSync(path.join(__dirname, 'core-summaries.json'), JSON.stringify(result, null, 2));

    return this.table(result);
  }

  private async summariesFrom(start: Date) {
    const summaries: WeekIssueSummary[] = [];
    for (const date of generateDatesFrom(start)) {
      const summary = await this.weekSummary(date);
      summaries.push(summary);
    }
    return summaries;
  }

  private async loadCached(): Promise<Cached> {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'core-summaries.json')).toString();
      const summaries = JSON.parse(raw, (key, value) => {
        return key === 'end' || key == 'start' ? new Date(value) : value;
      }) as WeekIssueSummary[];
      const firstUnprocessedDate = new Date(Math.max(...summaries.map(s => s.end.getTime())));
      firstUnprocessedDate.setDate(firstUnprocessedDate.getDate() + 1);
      return {
        summaries,
        firstUnprocessedDate,
      };
    } catch (e) {
      return {
        summaries: [],
        firstUnprocessedDate: new Date('2023-04-15'),
      };
    }
  }

  private async table(summaries: WeekIssueSummary[]): Promise<string> {
    return getMarkdownTable({
      table: {
        head: ['Week', 'Open Issues', 'IncomingP0', 'OpenP1', 'IncomingP1', 'ResolvedP1', 'OpenP2', 'IncomingP2', 'ResolvedP2'],
        body: summaries.map(summary => [
          formatWeek(summary.start),
          summary.openIssues.toString(),
          summary.incomingP0Issues.toString(),
          summary.openP1Issues.toString(),
          summary.incomingP1Issues.toString(),
          summary.resolvedP1Issues.toString(),
          summary.openP2Issues.toString(),
          summary.incomingP2Issues.toString(),
          summary.resolvedP2Issues.toString(),
        ]),
      },
    });
  }

  private weekSummary(date: Date): Promise<WeekIssueSummary> {
    const start = new Date(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    log(`PR statistics ${start}..${end}`);

    return Promise.all([
      this.openIssuesAt(end, this.CORE_LABLES),
      this.incomingIssuesBetween(start, end, this.CORE_LABLES.concat('p0')),
      this.openIssuesAt(end, this.CORE_LABLES.concat('p1')),
      this.incomingIssuesBetween(start, end, this.CORE_LABLES.concat('p1')),
      this.closedIssuesBetween(start, end, this.CORE_LABLES.concat('p1')),
      this.openIssuesAt(end, this.CORE_LABLES.concat('p2')),
      this.incomingIssuesBetween(start, end, this.CORE_LABLES.concat('p2')),
      this.closedIssuesBetween(start, end, this.CORE_LABLES.concat('p2')),
    ]).then(([openIssues, incomingP0Issues, openP1Issues, incomingP1Issues, resolvedP1Issues, openP2Issues, incomingP2Issues, resolvedP2Issues]) => ({
      openIssues,
      start,
      end,
      incomingP0Issues,
      openP1Issues,
      incomingP1Issues,
      resolvedP1Issues,
      openP2Issues,
      incomingP2Issues,
      resolvedP2Issues,
    }));
  }

  private incomingIssuesBetween(start: Date, end: Date, includeLables: string[] = [], excludeLables: string[] = []): Promise<number> {
    const s = toDateString(start);
    const e = toDateString(end);
    const i = this.includeLables(includeLables);
    const x = this.excludeLables(excludeLables);
    const query = `type:issue+repo:aws/aws-cdk+created:${s}..${e}${i}${x}`;
    return this.count(query);
  }

  private openIssuesAt(date: Date, includeLables: string[] = [], excludeLables: string[] = []): Promise<number> {
    const d = toDateString(date);
    const i = this.includeLables(includeLables);
    const x = this.excludeLables(excludeLables);
    const all = this.count(`type:issue+repo:aws/aws-cdk+created:<=${d}${i}${x}`);
    const closed = this.count(`type:issue+repo:aws/aws-cdk+closed:<=${d}${i}${x}`);
    return Promise.all([all, closed]).then(([a, c]) => a - c);
  }

  private closedIssuesBetween(start: Date, end: Date, includeLables: string[] = [], excludeLables: string[] = []): Promise<number> {
    const s = toDateString(start);
    const e = toDateString(end);
    const i = this.includeLables(includeLables);
    const x = this.excludeLables(excludeLables);
    const query = `type:issue+repo:aws/aws-cdk+closed:${s}..${e}${i}${x}`;
    return this.count(query);
  }


  private includeLables(labels: string[]): string {
    if (!labels) {
      return '';
    }
    return `+label:${labels.toString()}`;
  }

  private excludeLables(labels: string[]): string {
    if (!labels) {
      return '';
    }
    return `+-label:${labels.toString()}`;
  }

  private async count(query: string): Promise<number> {
    return (await this.octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: 1,
    })).data.total_count;
  }
}

async function main() {
  const octokitWithPlugins = Octokit.plugin(restEndpointMethods, throttling);

  const octokit = new octokitWithPlugins({
    auth: process.env.GITHUB_TOKEN,
    throttle: {
      onRateLimit: (retryAfter, _options, _octokit, retryCount) => {
        if (retryCount <= 2) {
          octokit.log.info(`Retrying after ${retryAfter} seconds!`);
          return true;
        }

        return false;
      },
      onSecondaryRateLimit: () => false,
    },
  });

  const sections = [];

  sections.push('# Core Team Issue Statistics');
  sections.push(await new CoreIssueStats(octokit).buildTable());

  fs.writeFileSync(path.join(__dirname, 'core-summaries.md'), sections.join('\n'), { encoding: 'utf-8' });
}

function generateDatesFrom(date: Date): Date[] {
  const now = new Date();
  const dates = new Array<Date>(52)
    .fill(new Date(date))
    .map((d, index) => {
      const newDate = new Date(d);
      newDate.setDate(newDate.getDate() + (index * 7));
      return newDate;
    });

  // setHours(0, 0, 0, 0) is used here to compare dates and
  // not get affected by time associated with the date
  return takeWhile(d => d.setHours(0, 0, 0, 0) < now.setHours(0, 0, 0, 0), dates);
}

/*
function monday(when: string | Date): Date {
  const date = new Date(when);
  const offset = (date.getDay() + 7 - 1) % 7;

  let ret = new Date(date);
  ret.setDate(date.getDate() - offset);
  ret.setUTCHours(0, 0, 0, 0);
  return ret;
}
*/

/**
 * Return the Mondays of all weeks encompassing both dates.
 */
/*
function mondaysBetween(start: string | Date, end: string | Date): Date[] {
  // getDay: sunday = 0
  let m = monday(start);
  const ret = [];
  while (m < new Date(end)) {
    ret.push(m);

    const next = new Date(m);
    next.setDate(next.getDate() + 7);
    m = next;
  }
  return ret;
}
*/

function takeWhile(predicate: (value: Date) => boolean, dates: Date[]): Date[] {
  const result: Date[] = [];
  for (const date of dates) {
    if (!predicate(date)) {
      break;
    }
    result.push(date);
  }
  return result;
}

function formatWeek(date: Date): string {
  const start = new Date(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)}`;
}

function toDateString(date: Date): string {
  return date.toISOString().replace(/T.*/, '');
}


function log(x: string) {
  console.log(`[${new Date().toISOString()}] ${x}`);
}

if (process.argv.slice(2).includes('-v')) {
  //DEBUG = true;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
