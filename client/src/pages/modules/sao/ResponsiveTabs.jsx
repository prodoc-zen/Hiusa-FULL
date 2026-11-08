import { Select, Tabs } from '../../../components/ui';

// A tab row that fits at 390px. From 640px it is the Tabs primitive; below that the same choices are
// one select, so no tab is cut off or hidden behind a sideways swipe that gives no sign it exists.
export default function ResponsiveTabs({ tabs, value, onChange, label, className = '' }) {
  return (
    <>
      <div className={`max-sm:hidden ${className}`}>
        <Tabs tabs={tabs} value={value} onChange={onChange} />
      </div>
      <div className={`sm:hidden ${className}`}>
        <Select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          {tabs.map((tab) => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
        </Select>
      </div>
    </>
  );
}
