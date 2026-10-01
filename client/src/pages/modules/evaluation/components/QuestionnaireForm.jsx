import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Send } from 'lucide-react';
import { Button, Field, Input, ProgressMeter, Textarea } from '../../../../components/ui';
import LikertRow from './LikertRow';
import ChoiceField from './ChoiceField';
import CheckboxGroup from './CheckboxGroup';
import { SECTION_META, SECTION_ORDER } from '../evaluationMeta';

function isAnswered(item, value) {
  if (item.type === 'multi_choice') return Array.isArray(value) && value.length > 0;
  if (item.type === 'likert') return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export default function QuestionnaireForm({ items, answers, onAnswersChange, onSubmit, submitting, submitError }) {
  const containerRef = useRef(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});

  const sections = useMemo(() => {
    const present = new Set(items.map((item) => item.section));
    return SECTION_ORDER.filter((code) => present.has(code)).map((code) => ({
      code,
      meta: SECTION_META[code],
      items: items.filter((item) => item.section === code),
    }));
  }, [items]);

  const current = sections[sectionIndex];
  const isLastSection = sectionIndex === sections.length - 1;

  function setAnswer(code, value) {
    onAnswersChange({ ...answers, [code]: value });
    if (fieldErrors[code]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[code];
        return next;
      });
    }
  }

  function validateCurrentSection() {
    const errors = {};
    current.items.forEach((item) => {
      if (item.required && !isAnswered(item, answers[item.code])) {
        errors[item.code] = `Please answer: "${item.prompt}"`;
      }
    });
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      const firstCode = current.items.find((item) => errors[item.code])?.code;
      const node = containerRef.current?.querySelector(`[data-field-code="${firstCode}"]`);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node?.querySelector('button, input, textarea')?.focus();
      return false;
    }

    return true;
  }

  function goNext() {
    if (!validateCurrentSection()) return;
    if (isLastSection) {
      onSubmit(answers);
      return;
    }
    setSectionIndex((index) => index + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    setFieldErrors({});
    setSectionIndex((index) => Math.max(0, index - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (!current) return null;

  return (
    <div ref={containerRef} className="mx-auto flex max-w-2xl flex-col gap-6">
      <ProgressMeter
        label={current.meta?.label || current.code}
        value={sectionIndex + 1}
        max={sections.length}
        valueLabel={`Section ${sectionIndex + 1} of ${sections.length}`}
      />

      <div className="flex flex-col gap-6">
        {current.items.map((item) => {
          const value = answers[item.code];
          const error = fieldErrors[item.code];

          if (item.type === 'likert') {
            return (
              <div key={item.code} data-field-code={item.code}>
                <LikertRow
                  code={item.code}
                  prompt={item.prompt}
                  options={item.options}
                  value={value}
                  onChange={(next) => setAnswer(item.code, next)}
                  error={error}
                  required={item.required}
                />
              </div>
            );
          }

          if (item.type === 'single_choice') {
            return (
              <div key={item.code} data-field-code={item.code}>
                <ChoiceField
                  prompt={item.prompt}
                  options={item.options}
                  value={value}
                  onChange={(next) => setAnswer(item.code, next)}
                  error={error}
                  required={item.required}
                />
              </div>
            );
          }

          if (item.type === 'multi_choice') {
            return (
              <div key={item.code} data-field-code={item.code}>
                <CheckboxGroup
                  prompt={item.prompt}
                  options={item.options}
                  value={value}
                  onChange={(next) => setAnswer(item.code, next)}
                  error={error}
                  required={item.required}
                />
              </div>
            );
          }

          const isLong = item.section === 'F' || item.prompt.length > 80;

          return (
            <div key={item.code} data-field-code={item.code}>
              <Field label={item.prompt} required={item.required} error={error}>
                {isLong ? (
                  <Textarea
                    value={value || ''}
                    maxLength={2000}
                    onChange={(event) => setAnswer(item.code, event.target.value)}
                  />
                ) : (
                  <Input
                    value={value || ''}
                    maxLength={2000}
                    onChange={(event) => setAnswer(item.code, event.target.value)}
                  />
                )}
              </Field>
            </div>
          );
        })}
      </div>

      {submitError && (
        <p role="alert" className="rounded-control border border-danger/30 bg-danger-tint px-4 py-3 text-sm font-semibold text-danger-strong">
          {submitError}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        <Button variant="secondary" leftIcon={ArrowLeft} onClick={goBack} disabled={sectionIndex === 0 || submitting}>
          Back
        </Button>
        <Button
          variant="primary"
          rightIcon={isLastSection ? undefined : ArrowRight}
          leftIcon={isLastSection ? Send : undefined}
          onClick={goNext}
          loading={submitting}
        >
          {isLastSection ? 'Submit evaluation' : 'Next section'}
        </Button>
      </div>
    </div>
  );
}
