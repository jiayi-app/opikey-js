/** The OPIKey agent skill (AgentSkills SKILL.md format), the same text served at https://opikey.ai/skill.md. */
export const SKILL_MD=`---
name: opikey
description: Call any API in the user's OPIKey Vault through one OPI Key, in plain language or with exact calls. Use when a task needs a third-party API such as email, payments, search or AI models.
---
# OPIKey

The user's API keys live in their OPIKey Vault. Never ask for raw API keys, and never print secrets.

- See which APIs you can use: \`opi apis\`
- Plain-language request (OPIKey picks and makes the calls): \`opi "send a test email to me with Resend"\`
- Exact call: \`opi call <api> <METHOD> <path> --data '<json>'\`
- Credits left: \`opi usage\`
- Run a program with the user's secrets as environment variables: \`opi run -- <command>\`

If a request comes back needing confirmation, show the planned calls to the user and only run it again with \`--confirm <id>\` after the user agrees. If a command says no OPI Key is set, ask the user to run \`opi login\`.
`;

/** Where each agent reads personal skills, relative to the home folder. */
export const SKILL_TARGETS={
 'claude-code':{label:'Claude Code',path:['.claude','skills','opikey','SKILL.md']},
 codex:{label:'Codex',path:['.agents','skills','opikey','SKILL.md']},
 openclaw:{label:'OpenClaw',path:['.openclaw','skills','opikey','SKILL.md']},
 hermes:{label:'Hermes Agent',path:['.hermes','skills','opikey','SKILL.md']},
 agents:{label:'agents that read ~/.agents/skills',path:['.agents','skills','opikey','SKILL.md']},
} as const;
export type SkillTarget=keyof typeof SKILL_TARGETS;
export function isSkillTarget(value:string|undefined):value is SkillTarget{return value!==undefined&&Object.hasOwn(SKILL_TARGETS,value);}
