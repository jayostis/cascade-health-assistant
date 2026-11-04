export declare function base64url(bytes: Uint8Array): string;
export declare function sha256(text: string): Promise<string>;
export declare class Signer {
    #private;
    constructor(secret: string);
    sign(note: object): Promise<string>;
    verify(signed: string): Promise<Record<string, unknown> | undefined>;
}
