// Generates 1000+ sample ticket records as JSON dataset
const fs = require('fs');

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
  'External monitor not detected', 'USB ports not working', 'Webcam not detected'
];

const SOLUTIONS = [
  'Renew certificate and restart VPN client', 'Reset password and clear browser cache',
  'Update graphics driver to latest version', 'Restart print spooler service',
  'Reinstall application', 'Check network cable and reconnect', 'Run Windows Update'
];

const r = arr => arr[Math.floor(Math.random() * arr.length)];
const ri = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const tickets = [];
for (let i = 1; i <= 1050; i++) {
  tickets.push({
    ticketId: `TKT-${String(i).padStart(5, '0')}`,
    issue: r(SAMPLE_ISSUES),
    category: r(CATEGORIES),
    priority: r(PRIORITIES),
    status: r(STATUSES),
    resolution: r(SOLUTIONS),
    aiConfidence: ri(75, 98) / 100
  });
}

fs.writeFileSync(__dirname + '/tickets_1000.json', JSON.stringify(tickets, null, 2));
console.log('Generated 1050 tickets in data/tickets_1000.json');
