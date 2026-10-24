{ pkgs ? import <nixpkgs> { config = {}; overlays = []; } }:
pkgs.mkShell {
  packages = with pkgs; [
    pkg-config openssl zlib libclang clang protobuf cmake llvmPackages.lld
  ];
  CFLAGS = "-O2";
  LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
}
