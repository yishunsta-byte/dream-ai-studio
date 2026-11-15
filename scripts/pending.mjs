const stages = { worker: "P1-6", "db:migrate": "P1-1", "db:seed": "P1-1" };
const command = process.argv[2];
const stage = stages[command];
console.error(stage
  ? `${command}: 아직 구현되지 않았습니다. ${stage}에서 제공됩니다. 데이터는 변경하지 않았습니다.`
  : "지원하지 않는 명령입니다.");
process.exitCode = 1;
