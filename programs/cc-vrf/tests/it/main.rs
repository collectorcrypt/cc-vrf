//! All cc_vrf integration suites in ONE test binary, so a run links the light-program-test stack once.
//! bash scripts/build-sbf.sh && bash scripts/test-prover.sh && CARGO_BUILD_JOBS=4 cargo test -p cc-vrf --test it -- --test-threads=2
mod common;

mod attest;
mod batch_event;
mod consumer;
mod differential;
mod idl_superset;
mod light_spike;
mod root_ring;
mod upgrade_path;
mod wire_pins;
