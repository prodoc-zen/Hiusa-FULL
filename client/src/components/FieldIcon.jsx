import { BookOpen, BriefcaseBusiness, Building2, CalendarDays, Clock3, CreditCard, FileImage, FileText, Flag, Hash, Layers3, ListFilter, ListTodo, LockKeyhole, Mail, MapPin, Megaphone, Package, Paperclip, Percent, Phone, Search, Send, Shapes, ShieldCheck, Smartphone, ToggleRight, Type, UserRound, UsersRound, Vote, Wallet } from 'lucide-react';

const ICON_RULES = [
  [/password|passcode|token/, LockKeyhole], [/email/, Mail], [/phone|contact number/, Phone],
  [/school id|student id|reference|code|acronym/, Hash], [/photo|image|poster|artwork|banner|qr/, FileImage],
  [/file|attachment|proof/, Paperclip], [/date|deadline|semester|schedule|period/, CalendarDays],
  [/time|duration|closing|expires/, Clock3], [/room|location|venue/, MapPin],
  [/organization|college|department/, Building2], [/program|course/, BookOpen], [/section|year level/, Layers3],
  [/role|permission|account status/, ShieldCheck], [/status|active|publish|important|pin to/, ToggleRight],
  [/position|assign/, BriefcaseBusiness], [/candidate|student|first name|last name|member|buyer|author/, UserRound],
  [/audience|participants|recipient/, UsersRound], [/election|voting|vote/, Vote], [/party/, Flag],
  [/announcement/, Megaphone], [/task|checklist|resource|requirement/, ListTodo], [/event/, CalendarDays],
  [/gcash|payment method/, Smartphone], [/payment|price|amount|budget|cost|income|expense|threshold/, Wallet],
  [/receipt/, CreditCard], [/quantity|stock|item|product|variant|size/, Package], [/percent|progress/, Percent],
  [/category|type/, Shapes], [/search/, Search], [/sort|filter|per page/, ListFilter], [/from|to/, Send],
  [/title|subject|name/, Type], [/description|note|content|body|reason|remarks|instruction|statement|context|responsibilit/, FileText],
];

export default function FieldIcon({ label }) {
  const Icon = ICON_RULES.find(([pattern]) => pattern.test(String(label).toLowerCase()))?.[1] || FileText;
  return <Icon size={14} aria-hidden="true" className="mr-1.5 inline-block shrink-0 align-[-2px] text-[#0878B7]" />;
}
