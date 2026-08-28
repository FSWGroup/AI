import type { WorkflowAction } from '@/lib/workflows';
import type { Audience } from '@/lib/audience';

/**
 * Ready-made workflow templates (§36). Installing one creates an ordinary
 * WorkflowDefinition that admins can then edit like any other.
 */
export const WORKFLOW_TEMPLATES: {
  key: string;
  name: string;
  description: string;
  trigger: string;
  conditions?: Audience;
  actions: WorkflowAction[];
}[] = [
  {
    key: 'new-hire-onboarding',
    name: 'New hire → start onboarding',
    description: 'When a worker is added, start the matching onboarding checklist and tell HR.',
    trigger: 'WORKER_ADDED',
    actions: [
      { type: 'START_ONBOARDING' },
      { type: 'NOTIFY_ROLE', roleKey: 'HR_ADMIN', title: 'Onboarding started for {{worker}}' },
    ],
  },
  {
    key: 'start-date-manager-prep',
    name: 'Start date approaching → manager prep task',
    description: 'A week before day one, remind the manager to prepare the first day.',
    trigger: 'START_DATE_APPROACHING',
    actions: [
      {
        type: 'CREATE_TASK',
        title: 'Prepare first day for {{worker}}',
        description: 'Workspace, welcome plan, introductions, first-week goals.',
        owner: 'MANAGER',
        category: 'ONBOARDING',
        dueOffsetDays: 5,
        priority: 'HIGH',
      },
    ],
  },
  {
    key: 'termination-access',
    name: 'Termination scheduled → IT access removal',
    description: 'Raise a critical IT task the moment a departure is scheduled.',
    trigger: 'TERMINATION_SCHEDULED',
    actions: [
      {
        type: 'CREATE_TASK',
        title: 'Revoke all application access for {{worker}}',
        ownerRoleKey: 'IT_ADMIN',
        category: 'IT_ACCESS',
        dueOffsetDays: 0,
        priority: 'CRITICAL',
      },
      { type: 'NOTIFY_ROLE', roleKey: 'FINANCE', title: 'Departure scheduled: {{worker}} — confirm final pay' },
    ],
  },
  {
    key: 'contract-expiring',
    name: 'Contract expiring → HR renewal review',
    description: 'Sixty days out, ask HR to review a contractor renewal.',
    trigger: 'CONTRACT_EXPIRING',
    actions: [
      {
        type: 'CREATE_TASK',
        title: 'Review contract renewal for {{worker}}',
        description: '{{detail}}',
        ownerRoleKey: 'HR_ADMIN',
        category: 'COMPLIANCE',
        dueOffsetDays: 14,
        priority: 'HIGH',
      },
    ],
  },
  {
    key: 'document-expiring',
    name: 'Document expiring → HR follow-up',
    description: 'Work authorization, certifications and other dated documents.',
    trigger: 'DOCUMENT_EXPIRING',
    actions: [
      {
        type: 'CREATE_TASK',
        title: 'Renew expiring document for {{worker}}',
        description: '{{detail}}',
        ownerRoleKey: 'HR_ADMIN',
        category: 'COMPLIANCE',
        dueOffsetDays: 10,
        priority: 'HIGH',
      },
    ],
  },
  {
    key: 'training-overdue',
    name: 'Training overdue → notify manager',
    description: 'Escalate overdue required training to the worker’s manager.',
    trigger: 'TRAINING_OVERDUE',
    actions: [{ type: 'NOTIFY_USER', userTarget: 'MANAGER', title: 'Training overdue for {{worker}}', body: '{{detail}}' }],
  },
  {
    key: 'anniversary',
    name: 'Work anniversary → manager note',
    description: 'A quiet nudge so anniversaries do not slip by.',
    trigger: 'ANNIVERSARY',
    actions: [{ type: 'NOTIFY_USER', userTarget: 'MANAGER', title: 'Work anniversary today: {{worker}} 🎉' }],
  },
  {
    key: 'equipment-unreturned',
    name: 'Equipment unreturned → IT follow-up',
    description: 'Chase company property past its return date.',
    trigger: 'EQUIPMENT_UNRETURNED',
    actions: [
      {
        type: 'CREATE_TASK',
        title: 'Recover equipment from {{worker}}',
        description: '{{detail}}',
        ownerRoleKey: 'IT_ADMIN',
        category: 'EQUIPMENT',
        dueOffsetDays: 5,
        priority: 'HIGH',
      },
    ],
  },
];
