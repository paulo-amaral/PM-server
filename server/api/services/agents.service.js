const request = require("request");
const fs = require("fs");
const path = require("path");

const winston = require("winston");
const _ = require("lodash");
const humanize = require("../../helpers/humanize");
const env = require("../../env/enviroment");

const Agent = require("../models").Agent;
const Group = require("../models").Group;

const LIVE_COUNTER = env.retries; // attempts before agent will be considered dead
const INTERVAL_TIME = env.interval_time;
let agents = {}; // store the agents status.


const FILTER_TYPES = Object.freeze({
    gte: 'gte',
    gt: 'gt',
    equal: 'equal',
    contains: 'contains',
    lte: 'lte',
    lt: 'lt'
});

const FILTER_FIELDS = Object.freeze({
    hostname: 'hostname',
    arch: 'arch',
    alive: 'alive',
    freeSpace: 'freeSpace',
    respTime: 'respTime',
    url: 'url',
    createdAt: 'createdAt'
});

/* Send a post request to agent every INTERVAL seconds. Data stored in the agent variable, which is exported */
let followAgentStatus = (agent) => {
    let start = new Date();
    agents[agent.key] = {};
    setDefaultUrl(agent);
    let listenInterval = setInterval(() => {
        request.post(
            agents[agent.key].defaultUrl + '/api/status', {
                form: {
                    key: agent.key
                }
            }, (error, response, body) => {
                try {
                    body = JSON.parse(body);
                } catch (e) {
                    body = { res: e };
                }
                if (!error && response.statusCode === 200) {
                    agents[agent.key].alive = true;
                    agents[agent.key].hostname = body.hostname;
                    agents[agent.key].arch = body.arch;
                    agents[agent.key].freeSpace = humanize.bytes(body.freeSpace);
                    agents[agent.key].respTime = new Date() - start;
                    agents[agent.key].url = agent.url;
                    agents[agent.key].publicUrl = agent.publicUrl;
                    agents[agent.key].defaultUrl = agents[agent.key].defaultUrl || '';
                    agents[agent.key].id = agent.id;
                    agents[agent.key].key = agent.key;
                    agents[agent.key].installed_plugins = body.installed_plugins;
                    agents[agent.key].liveCounter = LIVE_COUNTER;
                } else if ((--agents[agent.key].liveCounter) === 0) {
                    agents[agent.key].alive = false;
                    if (!agents[agent.key].hostname) {
                        agents[agent.key].hostname = 'unknown';
                    }
                    if (!agents[agent.key].arch) {
                        agents[agent.key].arch = 'unknown';
                    }
                    if (!agents[agent.key].freeSpace) {
                        agents[agent.key].freeSpace = 0;
                    }
                    agents[agent.key].respTime = 0;
                }
            })
    }, INTERVAL_TIME);
    if (!agents[agent.key]) {
        agents[agent.key] = { alive: false, following: true };
        // agents[agent.key] = { intervalId: listenInterval, alive: false, following: true };
    }
};

/* stop following an agent */
let unfollowAgentStatus = (agentId) => {
    let agent = _.find(agents, (o) => {
        return o.id === agentId
    });
    // stop the check interval
    if (!agent) {
        return;
    }
    clearInterval(agents[agent.key].intervalId);
    agents[agent.key].alive = false;
    agents[agent.key].following = false;

};

function getAgentStatus() {
    return agents;
}


function setDefaultUrl(agent) {
    return new Promise((resolve, reject) => {
        request.post(agent.publicUrl + '/api/status', { form: { key: agent.key } }, function (error, response, body) {
            if (error) {
                agents[agent.key].defaultUrl = agent.url;
            } else {
                agents[agent.key].defaultUrl = agent.publicUrl;
            }
            resolve();
        });
    });
}

/**
 * Evaluates group dynamic agents and constant agents.
 * @param group
 * @returns {any}
 */
function evaluateGroupAgents(group) {
    group = JSON.parse(JSON.stringify(group)); // make sure its not a mongoose document
    let agentsCopy = JSON.parse(JSON.stringify(agents));
    let filteredAgents = Object.keys(agentsCopy).map(key => agentsCopy[key]);
    group.filters.forEach(filter => {
        filteredAgents = evaluateFilter(filter, filteredAgents);
    });

    // array of the constant agents attached to the group
    const constAgents = group.agents.reduce((total, current) => {
        const agent = Object.keys(agentsCopy).find(key => {
            return agentsCopy[key].id === current;
        });
        if (agent) {
            total.push(agentsCopy[agent]);
        }
        return total;
    }, []);


    filteredAgents = [...filteredAgents, ...constAgents];
    return filteredAgents.reduce((total, current) => {
        total[current.key] = current;
        return total;
    }, {});
}

/**
 * Evaluates group's filter on given agents
 * @param filter
 * @param agents
 * @returns array of filtered agents
 */
function evaluateFilter(filter, agents) {
    return agents.filter(o => {
        if (!o[filter.field]) {
            return false;
        }
        switch (filter.filterType) {
            case FILTER_TYPES.equal: {
                if (!o[filter.field]) {
                    return false;
                }
                return o[filter.field].toString() === filter.value;
            }
            case FILTER_TYPES.contains: {
                return o[filter.field].includes(filter.value);
            }

            case FILTER_TYPES.gt: {
                try {
                    return parseFloat(o[filter.field]) > parseFloat(filter.value);
                } catch (e) {
                    return false;
                }
            }

            case FILTER_TYPES.gte: {
                try {
                    return parseFloat(o[filter.field]) >= parseFloat(filter.value);
                } catch (e) {
                    return false;
                }
            }

            case FILTER_TYPES.lt: {
                try {
                    return parseFloat(o[filter.field]) < parseFloat(filter.value);
                } catch (e) {
                    return false;
                }
            }

            case FILTER_TYPES.lte: {
                try {
                    return parseFloat(o[filter.field]) <= parseFloat(filter.value);
                } catch (e) {
                    return false;
                }
            }

            default: {
                return false;
            }
        }
    });
}

/**
 * Adding a socketid to agents statuses (if agentkey exists)
 * @param agentKey
 * @param socket
 */
function addSocketIdToAgent(agentKey, socket) {
    if (!agents.hasOwnProperty(agentKey)) {
        return;
    }
    agents[agentKey].socket = socket;
}

module.exports = {
    add: (agent) => {
        return Agent.findOne({ key: agent.key }).then(agentObj => {
            if (!agentObj) {
                return Agent.create(agent)
            }
            return Agent.findByIdAndUpdate(agentObj._id, { $set: { url: agent.url, publicUrl: agent.publicUrl } });
        })
    },
    // get an object of installed plugins and versions on certain agent.
    checkPluginsOnAgent: (agent) => {
        return new Promise((resolve, reject) => {
            console.log(agents[agent.key].defaultUrl);
            request.post(agents[agent.key].defaultUrl + '/api/plugins', { form: { key: agent.key } }, function (error, response, body) {
                if (error || response.statusCode !== 200) {
                    resolve('{}');
                }
                resolve(body);

            });
        });
    },
    delete: (agentId) => {
        return Agent.remove({ _id: agentId })
    },
    /* filter the agents. if no query is passed, will return all agents */
    filter: (query = {}) => {
        return Agent.find(query)
    },
    /* send plugin file to an agent */
    installPluginOnAgent: (pluginPath, agent) => {
        return new Promise((resolve, reject) => {
            let formData = {
                file: {
                    value: fs.createReadStream(pluginPath),
                    options: {
                        filename: path.basename(pluginPath)
                    }
                }
            };
            // if there is no agents, send this plugin to all living agents
            if (!agent) {
                for (let i in agents) {
                    if (!agents[i].alive) {
                        continue;
                    }

                    request.post({
                        url: agents[agent.key].defaultUrl + "/api/plugins/install",
                        formData: Object.assign(formData, { key: i })
                    });
                }
            } else {
                winston.log('info', "Sending request to agent");
                request.post({
                    url: agents[agent.key].defaultUrl + "/api/plugins/install",
                    formData: Object.assign(formData, { key: agent.key })
                }, function (err, res, body) {
                    winston.log('info', res, body);
                });
                resolve();
            }
        })
    },
    /* restarting the agents live status, and updating the status for all agents */
    restartAgentsStatus: () => {
        agents = {};
        Agent.find({}).then(agents => {
            agents.forEach(agent => {
                followAgentStatus(agent);
            })
        })
    },
    setDefaultUrl: setDefaultUrl,
    followAgent: followAgentStatus,
    unfollowAgent: unfollowAgentStatus,
    /* update an agent */
    update: (agentId, agent) => {
        return Agent.findByIdAndUpdate(agentId, agent, { new: true });
    },
    /* exporting the agents status */
    agentsStatus: getAgentStatus,

    /* Groups */
    /**
     * Creaqting new group object
     * @param group
     * @returns {group}
     */
    createGroup: (group) => {
        return Group.create(group);
    },

    groupsList: (query = {}) => {
        return Group.find(query);
    },

    /**
     * Adding agents to group
     * @param groupId
     * @param agentsId
     * @returns {Query}
     */
    addAgentToGroup: (groupId, agentsId) => {
        return Group.findByIdAndUpdate(groupId, { $addToSet: { agents: { $each: agentsId } } }, { new: true });
    },

    /**
     * Adding filters to group
     * @param groupId
     * @param filters
     * @returns {Query}
     */
    addGroupFilters: (groupId, filters) => {
        return Group.findByIdAndUpdate(groupId, { '$set': { 'filters': filters } }, { new: true });
    },

    /**
     * Delete a group.
     * @param groupId
     * @returns {Query}
     */
    deleteGroup: (groupId) => {
        return Group.findByIdAndRemove(groupId);
    },

    /**
     * Returning a group by it's id
     * @param groupId
     * @returns {Query}
     */
    groupDetail: (groupId) => {
        return Group.findById(groupId);
    },

    evaluateGroupAgents: evaluateGroupAgents,

    /**
     * Removes agents ref from groups.
     * @param agentId
     */
    removeAgentFromGroups: (agentId) => {
        return Group.update({ agents: { $in: [agentId] } }, { $pull: { agents: { $in: [agentId] } } })
    },

    /**
     * Removing an agent from a group
     * @param groupId
     * @param agentId
     * @returns {Query|*}
     */
    removeAgentFromGroup: (groupId, agentId) => {
        return Group.findOneAndUpdate(groupId, { $pull: { agents: { $in: [agentId] } } }, { new: true });
    },
    /**
     * Establish a room for agents
     * @param socket
     */
    establishSocket: (socket) => {
        const nsp = socket.of('/agents');
        nsp.on('connection', function (socket) {
            winston.log("info", "Agent log");
            // agent send key on connection string
            addSocketIdToAgent(socket.client.request._query.key, socket);
        });


    }
};