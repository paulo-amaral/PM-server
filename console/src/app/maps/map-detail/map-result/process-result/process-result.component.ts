import { Component, Input, OnChanges } from '@angular/core';

import * as moment from 'moment';


@Component({
  selector: 'app-process-result',
  templateUrl: './process-result.component.html',
  styleUrls: ['./process-result.component.scss']
})
export class ProcessResultComponent implements OnChanges {
  @Input('process') process: any;
  @Input('result') result: any;
  @Input('count') count: number;
  actions: any[];
  generalInfo: any;
  agProcessActionsStatus: any;
  agActionsStatus: any;
  colorScheme = {
    domain: ['#42bc76', '#f85555', '#ebb936', '#3FC9EB']
  };

  constructor() {
  }

  ngOnChanges(changes) {
    this.agProcessActionsStatus = null;
    this.agActionsStatus = null;
    this.generalInfo = null;
    this.aggregateProcessActionResults(this.result);
    if (this.process.length === 1) {
      this.generalInfo = this.result[0].processes.find(o => o.uuid === this.process[0].uuid && o.index === this.process[0].index);
    }
  }

  aggregateProcessActionResults(result) {
    let actions = [];
    this.process.forEach(process => {
      actions = [...actions, ...process.actions];
    });
    this.actions = actions;

    // aggregating actions status
    let agActionsStatus = actions.reduce((total, current) => {
      total[current.status] = (total[current.status] || 0) + 1;
      return total;
    }, { success: 0, error: 0, stopped: 0, partial: 0 });

    // formatting for chart
    this.agProcessActionsStatus = Object.keys(agActionsStatus).map((o) => {
      return { name: o, value: agActionsStatus[o] };
    });

    // aggregating status for each action
    let agActions = actions.reduce((total, current) => {
      if (!total[current.action]) {
        total[current.action] = {
          status: { success: 0, error: 0, stopped: 0 },
          results: { result: [], stderr: [], stdout: [] },
          startTime: new Date(),
          finishTime: new Date('1994-12-17T03:24:00')
        };
      }
      total[current.action]['status'][current.status] = (total[current.action][current.status] || 0) + 1;
      if (current.result) {

        total[current.action]['results']['result'].push(current.result.result);
        total[current.action]['results']['stderr'].push(current.result.stderr);
        total[current.action]['results']['stdout'].push(current.result.stdout);
      }
      total[current.action]['startTime'] = moment(current.startTime).isBefore(moment(total[current.action]['startTime'])) ? current.startTime : total[current.action]['startTime'];
      total[current.action]['finishTime'] = moment(current.finishTime).isAfter(moment(total[current.action]['finishTime'])) ? current.finishTime : total[current.action]['finishTime'];
      return total;
    }, {});

    Object.keys(agActions).map((o) => {
      agActions[o].total = this.calculateFinalStatus(agActions[o].status);
      // formatting for graph
      agActions[o].status = Object.keys(agActions[o].status).map((key) => {
        return { name: key, value: agActions[o].status[key] }
      });
    });
    this.agActionsStatus = agActions;
  }

  calculateFinalStatus(agStatus: { success: number, error: number, partial?: number }): 'success' | 'partial' | 'error' {
    if ((agStatus.partial && agStatus.partial > 0) || (agStatus.success && agStatus.error)) {
      return 'partial';
    }
    return agStatus.success ? 'success' : 'error';
  }

  showProcessResult(result) {
    return typeof result === 'string';
  }
}
