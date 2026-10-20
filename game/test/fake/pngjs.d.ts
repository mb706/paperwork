// The part of pngjs 7 the fake sim's debug snapshot uses (the package ships no types).
declare module 'pngjs' {
  export class PNG {
    constructor(options: { width: number; height: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: { write(png: PNG): Buffer; read(data: Buffer): PNG };
  }
}
