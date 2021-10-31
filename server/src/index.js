const Koa = require('koa');
const app = new Koa();
const server = require('http').createServer(app.callback());
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });
const Router = require('koa-router');
const cors = require('koa-cors');
const bodyparser = require('koa-bodyparser');

app.use(bodyparser());
app.use(cors());
app.use(async (ctx, next) => {
  const start = new Date();
  await next();
  const ms = new Date() - start;
  console.log(`${ctx.method} ${ctx.url} ${ctx.response.status} - ${ms}ms`);
});

app.use(async (ctx, next) => {
  await new Promise(resolve => setTimeout(resolve, 2000));
  await next();
});

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.response.body = { issue: [{ error: err.message || 'Unexpected error' }] };
    ctx.response.status = 500;
  }
});

class Task {
  constructor({ id, text, date, priority}) {
    this.id = id;
    this.text = text;
    this.date = date;
    this.priority = priority;
  }
}

const tasks = [];
for (let i = 0; i < 3; i++) {
  tasks.push(new Task({ id: `${i}`, text: `task ${i}`, date: new Date(Date.now() + i), priority: 1 }));
}
let lastUpdated = tasks[tasks.length - 1].date;
let lastId = tasks[tasks.length - 1].id;
const pageSize = 10;

const broadcast = data =>
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });

const router = new Router();

router.get('/task', ctx => {
  // console.log(tasks)
  const ifModifiedSince = ctx.request.get('If-Modif ied-Since');
  if (ifModifiedSince && new Date(ifModifiedSince).getTime() >= lastUpdated.getTime() - lastUpdated.getMilliseconds()) {
    ctx.response.status = 304; // NOT MODIFIED
    return;
  }
  const text = ctx.request.query.text;
  const page = parseInt(ctx.request.query.page) || 1;
  ctx.response.set('Last-Modified', lastUpdated.toUTCString());
  const sortedTasks = tasks
    .filter(task => text ? task.text.indexOf(text) !== -1 : true)
    .sort((n1, n2) => -(n1.date.getTime() - n2.date.getTime()));
  const offset = (page - 1) * pageSize;
  // ctx.response.body = {
  //   page,
  //   items: sortedItems.slice(offset, offset + pageSize),
  //   more: offset + pageSize < sortedItems.length
  // };
  // console.log(tasks);
  ctx.response.body = tasks;

  ctx.response.status = 200;
});

router.get('/task/:id', async (ctx) => {
  const taskId = ctx.request.params.id;
  const task = tasks.find(task => taskId === task.id);
  console.log(tasks)
  console.log(task);
  if (task) {
    ctx.response.body = task;
    ctx.response.status = 200; // ok
    console.log(tasks);
  } else {
    ctx.response.body = { issue: [{ warning: `task with id ${taskId} not found` }] };
    ctx.response.status = 404; // NOT FOUND (if you know the resource was deleted, then return 410 GONE)
  }
});

const createTask = async (ctx) => {
  const task = ctx.request.body;
  console.log(task);
  if (!task.text) { // validation
    ctx.response.body = { issue: [{ error: 'Text is missing' }] };
    ctx.response.status = 400; //  BAD REQUEST
    return;
  }
  task.id = `${parseInt(lastId) + 1}`;
  lastId = task.id;
  task.date = new Date();
  task.priority = 1;
  tasks.push(task);
  console.log(tasks)
  ctx.response.body = task;
  ctx.response.status = 201; // CREATED
  broadcast({ event: 'created', payload: { task } });
};

router.post('/task', async (ctx) => {
  await createTask(ctx);
});

router.put('/task/:id', async (ctx) => {
  const id = ctx.params.id;
  const task = ctx.request.body;
  task.date = new Date();
  const taskId = task.id;
  if (taskId && id !== task.id) {
    ctx.response.body = { issue: [{ error: `Param id and body id should be the same` }] };
    ctx.response.status = 400; // BAD REQUEST
    return;
  }
  if (!taskId) {
    await createTask(ctx);
    return;
  }
  const index = tasks.findIndex(task => task.id === id);
  if (index === -1) {
    ctx.response.body = { issue: [{ error: `task with id ${id} not found` }] };
    ctx.response.status = 400; // BAD REQUEST
    return;
  }
  const taskPriority = parseInt(ctx.request.get('ETag')) || task.priority;
  if (taskPriority < tasks[index].priority) {
    ctx.response.body = { issue: [{ error: `Priority conflict` }] };
    ctx.response.status = 409; // CONFLICT
    return;
  }
  task.priority++;
  tasks[index] = task;
  lastUpdated = new Date();
  ctx.response.body = task;
  ctx.response.status = 200; // OK
  broadcast({ event: 'updated', payload: { task } });
});

router.del('/task/:id', ctx => {
  const id = ctx.params.id;
  const index = tasks.findIndex(task => id === task.id);
  if (index !== -1) {
    const task = tasks[index];
    tasks.splice(index, 1);
    lastUpdated = new Date();
    broadcast({ event: 'deleted', payload: { task } });
  }
  ctx.response.status = 204; // no content
});

setInterval(() => {
  lastUpdated = new Date();
  lastId = `${parseInt(lastId) + 1}`;
  const task = new Task({ id: lastId, text: `task ${lastId}`, date: lastUpdated, priority: 1 });
  tasks.push(task);
  console.log(`
   ${task.text}`);
  broadcast({ event: 'created', payload: { task } });
}, 150000);

app.use(router.routes());
app.use(router.allowedMethods());

server.listen(3000);
