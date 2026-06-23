# Minimal fixture for feat(workflow_engine): Add in hook for producing occurrences from the stateful detector

class ReviewFixture:
    def changed_entry(self, value):
        return value

    def another_changed_entry(self, value):
        return value
