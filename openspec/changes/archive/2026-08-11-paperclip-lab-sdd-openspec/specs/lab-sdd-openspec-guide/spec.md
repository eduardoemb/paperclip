# Lab SDD OpenSpec Guide Specification

## Purpose

Define the required reproducibility record for the file-backed SDD lab smoke test.

## Requirements

### Requirement: Configuration disclosure

The guide MUST state automatic mode, the `openspec` artifact store, `single-pr` delivery strategy, and a 400-line review budget.

#### Scenario: Reader inspects configuration

- GIVEN the guide exists
- WHEN a reader reviews its parameters
- THEN all four required configuration values are present

### Requirement: Persistence and recovery disclosure

The guide MUST name the OpenSpec artifact paths and provide verification and rollback steps.

#### Scenario: Reader follows recovery information

- GIVEN the lifecycle has been archived
- WHEN a reader follows the guide
- THEN they can locate the record and validate or remove it without product-source changes
