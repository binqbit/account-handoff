FROM rust:1.99.0-bookworm@sha256:114c7a4425406451c2866b6aafe69fe29b1b298832db1277d411ac73c82d04d6 AS toolchain

FROM toolchain AS build
ARG SOURCE_COMMIT=b76182dd335abcc07b0ff876d4889416a4c08ab7
ARG CARGO_JOBS=6
RUN rm -f /etc/apt/sources.list.d/debian.sources && \
    printf '%s\n' 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20261001T000000Z bookworm main' \
    'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20261001T000000Z bookworm-security main' > /etc/apt/sources.list && \
    apt-get -o APT::Update::Error-Mode=any update && apt-get install -y --no-install-recommends ca-certificates clang libclang-dev protobuf-compiler cmake pkg-config libssl-dev libudev-dev && \
    rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32v1-none wasm32-unknown-unknown
WORKDIR /source
RUN git init && git remote add origin https://github.com/paritytech/polkadot-sdk.git && \
    git fetch --depth 1 origin "$SOURCE_COMMIT" && git checkout --detach FETCH_HEAD
COPY infra/local/patches/0001-account-handoff-local.patch /patches/local.patch
RUN git apply --check /patches/local.patch && git apply /patches/local.patch
ENV CARGO_BUILD_JOBS=$CARGO_JOBS CARGO_PROFILE_RELEASE_DEBUG=0 CFLAGS=-O2
RUN cargo build --locked --release -p staging-node-cli --bin substrate-node -p pallet-revive-eth-rpc --bin eth-rpc

FROM debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8 AS runtime-base
# Bootstrap HTTPS from the same pinned toolchain image before installing packages.
COPY --from=toolchain /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN rm -f /etc/apt/sources.list.d/debian.sources && \
    printf '%s\n' 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20261001T000000Z bookworm main' \
    'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20261001T000000Z bookworm-security main' > /etc/apt/sources.list && \
    apt-get -o APT::Update::Error-Mode=any update && apt-get install -y --no-install-recommends ca-certificates libssl3 libudev1 && rm -rf /var/lib/apt/lists/* && \
    useradd --uid 10001 --create-home runtime && \
    mkdir -p /home/runtime/native /home/runtime/gateway && chown -R runtime:runtime /home/runtime

FROM runtime-base AS runtime
COPY --from=build /source/target/release/substrate-node /usr/local/bin/substrate-node
COPY --from=build /source/target/release/eth-rpc /usr/local/bin/eth-rpc
USER runtime
WORKDIR /home/runtime
EXPOSE 9944 8545
CMD ["substrate-node", "--help"]
