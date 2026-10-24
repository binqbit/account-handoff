# Account Handoff

## The team changes. The grant beneficiary stays.

Account Handoff is a Portaldot application designed to help grant-funded teams replace a signing group while preserving the beneficiary account and ongoing grant.

The team establishes a dedicated native Pure account before receiving the grant. A threshold of team members controls it through native Multisig and Proxy. The same account holds native vesting schedules and appears as the beneficiary in a compatible Revive grant application.

When a signer leaves, the current quorum authorizes a replacement group. That group removes the old controller and submits the next milestone on the same grant. The interface verifies the complete outcome: new control, unchanged beneficiary identity and continued grant work.

This workflow requires an available current signing quorum and a grant created for the dedicated account from the outset. It does not hold private keys, recover a lost quorum or turn a controller change into a legal reassignment of the grant.

## Documentation

This repository describes the product and its mechanics. Start with the [documentation guide](docs/README.md), then read the [concept](docs/concept.md), [how it works](docs/how-it-works.md), [architecture](docs/architecture.md), [worked example](docs/example.md), and [operating boundaries](docs/safety-and-limitations.md).
