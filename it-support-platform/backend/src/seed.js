import 'dotenv/config';
import mongoose from 'mongoose';
import User from './models/User.js';
import Ticket from './models/Ticket.js';
import { connectDB } from './config/db.js';

const CATEGORIES = ['Network', 'Hardware', 'Software', 'Security', 'Email', 'VPN', 'Account', 'General'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES = ['Open', 'In Progress', 'Resolved', 'Escalated'];

const SAMPLE_ISSUES = [
  'VPN not connecting', 'Cannot access email', 'Laptop slow', 'Printer not working',
  'Password reset needed', 'Monitor flickering', 'Software installation required',
  'Network drive not accessible', 'Outlook crashing', 'WiFi drops frequently',
  'Certificate expired', 'Windows update failed', 'Excel freezing', 'Cannot print',
  'Remote desktop not working', 'Mouse not responding', 'Keyboard keys stuck',
  'Blue screen error', 'Disk space full', 'Application crash on startup',
  'Login credentials not working', 'Two-factor authentication issue',
  'SharePoint access denied', 'Teams meeting audio not working',
  'External monitor not detected', 'USB ports not working', 'Webcam not detected',
  'Slow internet connection', 'Firewall blocking application', 'Antivirus update failed',
  'Projector not displaying', 'Conference room booking system down',
  'CRM system login issues', 'SAP access denied', 'Backup restore needed',
  'File recovery request', 'New employee onboarding setup', 'Laptop replacement needed',
  'Phone system not working', 'Voicemail full', 'Mobile device sync issues'
];

const ROOT_CAUSES = [
  'Certificate expired', 'DNS configuration issue', 'Driver outdated',
  'Corrupted user profile', 'Firewall blocking', 'Incorrect credentials',
  'Service not running', 'Disk fragmentation', 'Memory leak in application'
];

const SOLUTIONS = [
  'Renew certificate and restart VPN client',
  'Reset password and clear browser cache',
  'Update graphics driver to latest version',
  'Restart print spooler service',
  'Reinstall application',
  'Check network cable and reconnect',
  'Run Windows Update',
  'Clear temp files and restart'
];

function random(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function seed() {
  await connectDB();
  await User.deleteMany({});
  await Ticket.deleteMany({});

  const admin = await User.create({
    email: 'admin@test.com',
    password: 'password123',
    name: 'Admin User',
    role: 'admin'
  });

  const agentDefs = [
    { email: 'agent@test.com', password: 'password123', name: 'John Smith', role: 'agent', skills: ['Network', 'VPN', 'Security'], workload: 0 },
    { email: 'agent2@test.com', password: 'password123', name: 'Sarah Jones', role: 'agent', skills: ['Hardware', 'Software'], workload: 0 },
    { email: 'agent3@test.com', password: 'password123', name: 'Mike Wilson', role: 'agent', skills: ['Email', 'Account', 'Network'], workload: 0 }
  ];

  const agents = [];
  for (const def of agentDefs) {
    agents.push(await User.create(def));
  }

  const employeeDefs = [
    { email: 'employeetest@gmail.com', password: 'password123', name: 'Alice Brown', role: 'employee' },
    { email: 'bob@company.com', password: 'password123', name: 'Bob Davis', role: 'employee' },
    { email: 'carol@company.com', password: 'password123', name: 'Carol Evans', role: 'employee' }
  ];

  const employees = [];
  for (const def of employeeDefs) {
    employees.push(await User.create(def));
  }

  for (let i = 0; i < 50; i++) {
    await User.create({
      email: `emp${i}@company.com`,
      password: 'password123',
      name: `Employee ${i}`,
      role: 'employee'
    });
  }

  const allUsers = await User.find();
  const empIds = allUsers.filter(u => u.role === 'employee').map(u => u._id);
  const agentIds = agents.map(a => a._id);

  for (let i = 1; i <= 1050; i++) {
    const issue = SAMPLE_ISSUES[Math.floor(Math.random() * SAMPLE_ISSUES.length)];
    const category = random(CATEGORIES);
    const priority = random(PRIORITIES);
    const status = random(STATUSES);
    const userId = empIds[Math.floor(Math.random() * empIds.length)];
    const assignedAgent = status !== 'Open' ? agentIds[Math.floor(Math.random() * agentIds.length)] : null;
    
    const created = new Date(2024, 0, 1 + randomInt(0, 400));
    const resolved = status === 'Resolved' ? new Date(created.getTime() + randomInt(1, 72) * 3600000) : null;

    await Ticket.create({
      ticketId: `TKT-${String(i).padStart(5, '0')}`,
      userId,
      assignedAgentId: assignedAgent,
      issue,
      category,
      priority,
      status,
      aiAnalysis: {
        category,
        priority,
        confidence: randomInt(75, 98),
        rootCause: random(ROOT_CAUSES),
        suggestedFix: [random(SOLUTIONS), random(SOLUTIONS)],
        similarTickets: [
          { ticketId: `TKT-${randomInt(1, i - 1)}`, issue: random(SAMPLE_ISSUES), solution: random(SOLUTIONS), similarity: randomInt(85, 98) / 100 }
        ]
      },
      slaDeadline: new Date(created.getTime() + 24 * 60 * 60 * 1000),
      resolution: status === 'Resolved' ? random(SOLUTIONS) : null,
      resolvedAt: resolved,
      createdAt: created,
      updatedAt: resolved || created
    });
  }

  console.log('Seed complete: 1050+ tickets, users created');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
