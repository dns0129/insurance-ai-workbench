// Only the fictional labels, commissions, and events live here.
// Premiums, policy counts, and goals continue to come from dashboard().
const profiles = new Map([
  ['A006', {employment:'兼职',rows:[
    ['P-01','settled',1200],['P-02','settled',600],['P-03','pending',600],
  ]}],
  ['A001', {employment:'全职',rows:[
    ['F-01','settled',4600],['F-02','settled',2500],['F-03','pending',1400],
  ]}],
]);
const activities = [
  {id:'product-qa',scope:'team',at:'2026-11-17T19:30:00+08:00',title:'团队产品答疑',detail:'带一个产品或保障条款问题参加，提前整理要核对的资料。'},
  {id:'workbench',scope:'company',at:'2026-11-19T12:30:00+08:00',title:'工作台入门培训',detail:'用虚构样例练习登录、查看个人进度和投保资料预检。'},
  {id:'weekly',scope:'team',at:'2026-11-20T18:00:00+08:00',title:'本周业务复盘',detail:'准备本周进度、一个典型问题和下周想推进的一件事。'},
];
export const demoEmployment = id => profiles.get(id)?.employment ?? null;

export function personalDemo(session, month) {
  if (session.role !== 'agent') return undefined;
  const profile = profiles.get(session.agent_id);
  const rows = month === '2026-10' ? profile?.rows ?? [] : [];
  return {
    employment: profile?.employment ?? null,
    commission: {
      month, currency:'HKD', simulated:true,
      rows:rows.map(([id,status,amount])=>({id,status,amount})),
    },
    activities:{simulated:true,timezone:'Asia/Hong_Kong',items:activities},
  };
}
